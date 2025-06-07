import * as http from 'http';
import * as https from 'https';
import path from 'path';
import { Service } from './Service';
import { Utils } from '../Utils';
import express, { Express, Request, Response, NextFunction } from 'express';
import { Config } from '../Config';
import { TypedEmitter } from '../../common/TypedEmitter';
import * as process from 'process';
import { EnvName } from '../EnvName';
import basicAuth from 'express-basic-auth'; // Add this for basic authentication
import * as crypto from 'crypto';

const DEFAULT_STATIC_DIR = path.join(__dirname, './public');

const PATHNAME = process.env[EnvName.WS_SCRCPY_PATHNAME] || __PATHNAME__;

export type ServerAndPort = {
    server: https.Server | http.Server;
    port: number;
};

interface HttpServerEvents {
    started: boolean;
}

export class HttpServer extends TypedEmitter<HttpServerEvents> implements Service {
    private static instance: HttpServer;
    private static PUBLIC_DIR = DEFAULT_STATIC_DIR;
    private static SERVE_STATIC = true;
    private servers: ServerAndPort[] = [];
    private mainApp?: Express;
    private started = false;
    private usedSignatures: Map<string, { timestamp: number; ip: string; userAgent: string }> = new Map();

    protected constructor() {
        super();
        // Clean expired signatures every minute
        setInterval(() => this.cleanupOldSignatures(), 600000);
    }

    private cleanupOldSignatures(): void {
        const tenSecondsAgo = Date.now() - 60000;
        for (const [signature, data] of this.usedSignatures.entries()) {
            if (data.timestamp < tenSecondsAgo) {
                this.usedSignatures.delete(signature);
            }
        }
    }

    private isValidTimestamp(timestamp: number): boolean {
        const currentTime = Date.now();
        return !isNaN(timestamp) && timestamp <= currentTime && currentTime - timestamp <= 60000;
    }

    public static getInstance(): HttpServer {
        if (!this.instance) {
            this.instance = new HttpServer();
        }
        return this.instance;
    }

    public static hasInstance(): boolean {
        return !!this.instance;
    }

    public static setPublicDir(dir: string): void {
        if (HttpServer.instance) {
            throw Error('Unable to change value after instantiation');
        }
        HttpServer.PUBLIC_DIR = dir;
    }

    public static setServeStatic(enabled: boolean): void {
        if (HttpServer.instance) {
            throw Error('Unable to change value after instantiation');
        }
        HttpServer.SERVE_STATIC = enabled;
    }

    public async getServers(): Promise<ServerAndPort[]> {
        if (this.started) {
            return [...this.servers];
        }
        return new Promise<ServerAndPort[]>((resolve) => {
            this.once('started', () => {
                resolve([...this.servers]);
            });
        });
    }

    public getName(): string {
        return `HTTP(s) Server Service`;
    }

    public verifySignature(req: Request): boolean {
        const SECRET_KEY = process.env.SIGNATURE_SECRET_KEY;
        if (!SECRET_KEY) {
            throw new Error('Environment variable SIGNATURE_SECRET_KEY must be set');
        }

        const timestamp = req.query.timestamp;
        const receivedSignature = req.query.signature as string;
        const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
        const userAgent = req.headers['user-agent'] || 'unknown';

        if (!timestamp || !receivedSignature || typeof timestamp !== 'string') {
            return false;
        }

        const timestampNum = parseInt(timestamp, 10);
        if (!this.isValidTimestamp(timestampNum)) {
            return false;
        }

        // Check if signature has been used
        if (this.usedSignatures.has(receivedSignature)) {
            const data = this.usedSignatures.get(receivedSignature)!;
            if (data.ip === clientIp && data.userAgent === userAgent && data.timestamp === timestampNum) {
                return true;
            }
            return false;
        }

        // Calculate signature: use timestamp as salt
        const hmac = crypto.createHmac('sha256', SECRET_KEY);
        const dataToHash = `${timestamp}:${SECRET_KEY}`; // Add timestamp to increase randomness
        hmac.update(dataToHash);
        const calculatedSignature = hmac.digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

        // Verify signature
        if (receivedSignature === calculatedSignature) {
            this.usedSignatures.set(receivedSignature, { 
                timestamp: timestampNum, 
                ip: clientIp,
                userAgent: userAgent
            });
            return true;
        }

        return false;
    }

    public async start(): Promise<void> {
        this.mainApp = express(); // Check environment variables
        const adminUser = process.env.ADMIN_USE ?? '';
        const adminPassword = process.env.ADMIN_PASSWORD ?? '';

        // Create middleware based on environment variables presence
        const authMiddleware = basicAuth({
            users: { 
                [adminUser]: adminPassword 
            },
            challenge: true,
            realm: 'Restricted Access',
        }); 
        // Protect the base path
        this.mainApp.use((req: Request, res: Response, next: NextFunction) => {
            if (req.path === '/' && req.query.signature && req.query.timestamp) {
                // Using signature verification
                if (this.verifySignature(req)) {
                    next();
                } else {
                    res.status(403).send('Invalid signature or expired timestamp');
                }
            } else if (req.path === '/') {
                if(!adminUser || !adminPassword){
                    res.status(404).end();
                }
                // Using basic authentication
                authMiddleware(req, res, next);
            } else {
                // Allow access to other paths
                next();
            }
        });

        // this.mainApp.use((req: Request, _res: Response, next: NextFunction) => {
        //     console.log('Protocol:', req.protocol); // Log the protocol (http or https)
        //     next();
        // });

        this.mainApp.post('/logout', (_req: Request, res: Response) => {
            console.log('Logging out');
            res.setHeader('WWW-Authenticate', 'Basic realm="Restricted Access"');
            res.status(401).send('Logged out successfully');
        });

        if (HttpServer.SERVE_STATIC && HttpServer.PUBLIC_DIR) {
            this.mainApp.use(PATHNAME, express.static(HttpServer.PUBLIC_DIR));

            /// #if USE_WDA_MJPEG_SERVER

            const { MjpegProxyFactory } = await import('../mw/MjpegProxyFactory');
            this.mainApp.get('/mjpeg/:udid', new MjpegProxyFactory().proxyRequest);
            /// #endif
        }

        const config = Config.getInstance();
        config.servers.forEach((serverItem) => {
            const { secure, port, redirectToSecure } = serverItem;
            let proto: string;
            let server: http.Server | https.Server;
            if (secure) {
                if (!serverItem.options) {
                    throw Error('Must provide option for secure server configuration');
                }
                server = https.createServer(serverItem.options, this.mainApp);
                proto = 'https';
            } else {
                const options = serverItem.options ? { ...serverItem.options } : {};
                proto = 'http';
                let currentApp = this.mainApp;
                let host = '';
                let port = 443;
                let doRedirect = false;
                if (redirectToSecure === true) {
                    doRedirect = true;
                } else if (typeof redirectToSecure === 'object') {
                    doRedirect = true;
                    if (typeof redirectToSecure.port === 'number') {
                        port = redirectToSecure.port;
                    }
                    if (typeof redirectToSecure.host === 'string') {
                        host = redirectToSecure.host;
                    }
                }
                if (doRedirect) {
                    currentApp = express();
                    currentApp.use(function (req, res) {
                        const url = new URL(`https://${host ? host : req.headers.host}${req.url}`);
                        if (port && port !== 443) {
                            url.port = port.toString();
                        }
                        return res.redirect(301, url.toString());
                    });
                }
                server = http.createServer(options, currentApp);
            }
            this.servers.push({ server, port });
            server.listen(port, () => {
                Utils.printListeningMsg(proto, port, PATHNAME);
            });
        });
        this.started = true;
        this.emit('started', true);
    }

    public release(): void {
        this.servers.forEach((item) => {
            item.server.close();
        });
    }
}
