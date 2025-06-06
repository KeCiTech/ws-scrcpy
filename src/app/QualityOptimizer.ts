import VideoSettings from './VideoSettings';
import { BasePlayer } from './player/BasePlayer';
import { StreamClientScrcpy } from './googDevice/client/StreamClientScrcpy';

export class QualityOptimizer {
    private readonly MAX_BITRATE = 22 * 1024 * 1024; // 22 Mbps
    private readonly MIN_BITRATE = 500 * 1024; // 500 Kbps
    private readonly MAX_FPS = 60;
    private readonly MIN_FPS = 15;
    private readonly INTERVAL = 2000; // Check every 2 seconds
    private timerId?: number;
    private wsLatency = 0;
    private wsQualityScore = 1;
    private latencyHistory: number[] = [];
    // private lastOrientation?: number;
    private pendingOrientationChange = false;
    private lastStats: {
        decodedFrames: number;
        droppedFrames: number;
        timestamp: number;
        bitrate: number;
    } = {
        decodedFrames: 0,
        droppedFrames: 0,
        timestamp: 0,
        bitrate: 0,
    };

    constructor(private player: BasePlayer, private client: StreamClientScrcpy) {
        // Listen for screen orientation changes
        // this.lastOrientation = player.getScreenInfo()?.deviceRotation;
        // player.on('video-settings', () => this.checkOrientation());
    }

    public start(): void {
        if (this.timerId) {
            return;
        }
        this.timerId = window.setInterval(() => this.optimize(), this.INTERVAL);
    }

    public stop(): void {
        if (this.timerId) {
            window.clearInterval(this.timerId);
            this.timerId = undefined;
        }
    }

    public updateWSMetrics(latency: number): void {
        // Save the most recent 10 latency data points
        this.latencyHistory.push(latency);
        if (this.latencyHistory.length > 10) {
            this.latencyHistory.shift();
        }

        // Calculate average latency and jitter
        const avgLatency = this.latencyHistory.reduce((a, b) => a + b, 0) / this.latencyHistory.length;
        const jitter = Math.sqrt(
            this.latencyHistory.reduce((sum, val) => sum + Math.pow(val - avgLatency, 2), 0) /
                this.latencyHistory.length,
        );

        // Update latency
        this.wsLatency = avgLatency;

        // Calculate connection quality score (0-1) based on latency and jitter
        const latencyScore = Math.max(0, 1 - avgLatency / 500); // Worst case for latency over 500ms
        const jitterScore = Math.max(0, 1 - jitter / 100); // Worst case for jitter over 100ms
        this.wsQualityScore = (latencyScore + jitterScore) / 2;
    }

    // private checkOrientation(): void {
    //     const currentOrientation = this.player.getScreenInfo()?.deviceRotation;
    //     if (currentOrientation !== undefined && currentOrientation !== this.lastOrientation) {
    //         this.lastOrientation = currentOrientation;
    //         this.pendingOrientationChange = true;
    //         // Trigger quality optimization immediately after orientation change
    //         // this.optimize();
    //     }
    // }

    private getNetworkInfo() {
        const conn = (navigator as any).connection;
        const networkQuality = this.getNetworkQuality(conn?.effectiveType);
        const downlink = conn?.downlink || 10; // Default 10Mbps
        const maxBitrate = Math.min(this.MAX_BITRATE, downlink * 1024 * 1024);

        // Combine WebSocket metrics and network API
        const combinedQuality = (networkQuality + this.wsQualityScore) / 2;

        return {
            effectiveType: conn?.effectiveType || '4g',
            downlink,
            quality: combinedQuality,
            maxBitrate,
            wsLatency: this.wsLatency,
            wsQualityScore: this.wsQualityScore,
        };
    }

    private getNetworkQuality(effectiveType: string = '4g'): number {
        switch (effectiveType) {
            case '4g':
                return 1;
            case '3g':
                return 0.7;
            case '2g':
                return 0.4;
            case 'slow-2g':
                return 0.2;
            default:
                return 1;
        }
    }
    private isIpv4Address(url: string): boolean {
        try {
            const { hostname, protocol } = new URL(url);
            // Ensure HTTP or HTTPS protocol
            if (!protocol.startsWith('http')) {
                return false;
            }
            // Consider localhost as an IP address
            if (hostname === 'localhost') {
                return true;
            }
            // Strict IPv4 format check
            const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
            if (!ipv4Regex.test(hostname)) {
                return false;
            }
            // Validate each number is in the range 0-255
            const parts = hostname.split('.');
            return parts.every((part) => {
                const num = parseInt(part, 10);
                return num >= 0 && num <= 255;
            });
        } catch {
            return false;
        }
    }
    private isIpv6Address(url: string): boolean {
        try {
            const { hostname, protocol } = new URL(url);
            // Ensure HTTP or HTTPS protocol
            if (!protocol.startsWith('http')) {
                return false;
            }
            // Remove possible brackets
            const address = hostname.replace(/^\[/, '').replace(/\]$/, '');
            // More complete IPv6 regex, supporting more valid IPv6 formats
            const ipv6Regex = /^(?:[A-F0-9]{1,4}:){7}[A-F0-9]{1,4}$/i;
            return ipv6Regex.test(address);
        } catch {
            return false;
        }
    }

    private getServerUrl(): string {
        // Get current page URL
        return window.location.href;
    }

    private async optimize(): Promise<void> {
        // Get current server address and check if accessed via IP address
        const serverUrl = this.getServerUrl();
        const isIpAddress = serverUrl && (this.isIpv4Address(serverUrl) || this.isIpv6Address(serverUrl));

        // If accessed via IP address, force maximum quality settings
        if (isIpAddress) {
            const currentSettings = this.player.getVideoSettings();
            // Check if settings need to be updated (first time or parameters do not match highest quality)
            if (
                this.lastStats.timestamp === 0 ||
                currentSettings.bitrate !== this.MAX_BITRATE ||
                currentSettings.maxFps !== 60 ||
                currentSettings.iFrameInterval !== 60
            ) {
                console.log('[QualityOptimizer] IP address detected, setting maximum quality');
                const newSettings = new VideoSettings({
                    ...currentSettings,
                    bitrate: this.MAX_BITRATE,
                    maxFps: 60,
                    iFrameInterval: 60,
                });

                // Simultaneously update video settings for client and player
                this.client.sendNewVideoSetting(newSettings);
                this.player.setVideoSettings(newSettings, true, true);

                // Force set highest quality score
                this.wsQualityScore = 1.0;
                this.lastStats.timestamp = Date.now(); // Update timestamp
                this.lastStats.bitrate = this.MAX_BITRATE;

                console.log('[QualityOptimizer] Maximum quality settings applied:', {
                    bitrate: Math.round(this.MAX_BITRATE / 1024) + 'kbps',
                    maxFps: 60,
                    iFrameInterval: 60,
                });

                // When accessed via IP address, skip subsequent optimization logic if maximum quality settings have been applied
                return;
            }
        }

        // Get current quality data
        const stats = this.player.getQualityStats();
        const framesStats = this.player.getFramesStats();
        if (!stats || !framesStats) {
            console.warn('[QualityOptimizer] No quality stats available');
            return;
        }

        const now = Date.now();
        const timeDiff = now - this.lastStats.timestamp;
        // If optimization is due to orientation change, ignore time interval restriction
        if (!this.pendingOrientationChange && timeDiff < 1000) {
            return;
        }
        this.pendingOrientationChange = false;

        try {
            // Calculate frame drop rate using per second statistics
            const droppedFramesRate = framesStats.avgInput > 0 ? framesStats.avgDropped / framesStats.avgInput : 0;

            // Get network status and current settings
            const networkInfo = this.getNetworkInfo();
            const currentSettings = this.player.getVideoSettings();
            let { bitrate, maxFps } = currentSettings; // Adjust settings based on network status and performance
            let qualityScore = 1.0;

            // 1. Consider frame rate performance
            if (framesStats.avgInput > 0) {
                const frameDeliveryScore = framesStats.avgDecoded / framesStats.avgInput;
                qualityScore *= frameDeliveryScore;
            }

            // 2. Consider frame drop situation
            if (droppedFramesRate > 0) {
                qualityScore *= 1 - droppedFramesRate;
            }

            // 3. Consider network latency
            if (networkInfo.wsLatency > 0) {
                const latencyScore = Math.max(0, 1 - networkInfo.wsLatency / 500);
                qualityScore *= latencyScore;
            }

            // 4. Determine if adjustment is needed
            if (qualityScore < 0.4) {
                // Insufficient performance, need to reduce quality
                const reductionFactor = Math.max(0.3, qualityScore);
                bitrate = Math.max(this.MIN_BITRATE, Math.floor(bitrate * reductionFactor));
                maxFps = Math.max(this.MIN_FPS, maxFps - 5);
                console.log('[QualityOptimizer] Reducing quality, score:', qualityScore.toFixed(2));
            } else if (qualityScore > 0.8 && framesStats.avgSize > 0) {
                // Sufficient performance, can increase quality
                // Check bandwidth usage
                const currentBandwidthUtilization = framesStats.avgSize * 8; // bits per second
                const bandwidthHeadroom = networkInfo.maxBitrate - currentBandwidthUtilization;

                if (bandwidthHeadroom > bitrate * 0.2) {
                    // If there is more than 20% bandwidth headroom
                    bitrate = Math.min(networkInfo.maxBitrate * 0.9, bitrate * 1.1);
                    maxFps = Math.min(this.MAX_FPS, maxFps + 2);
                    console.log('[QualityOptimizer] Increasing quality, score:', qualityScore.toFixed(2));
                }
            }

            // Apply new settings
            if (bitrate !== currentSettings.bitrate || maxFps !== currentSettings.maxFps) {
                const newSettings = new VideoSettings({
                    ...currentSettings,
                    bitrate,
                    maxFps,
                    // Dynamically adjust I-frame interval based on frame rate and latency
                    iFrameInterval: Math.max(1, Math.floor(maxFps / (4 * Math.max(1, networkInfo.wsLatency / 100)))),
                }); // Update settings and save state
                this.client.sendNewVideoSetting(newSettings);
                this.player.setVideoSettings(newSettings, true, true);
                this.lastStats = {
                    decodedFrames: stats.decodedFrames,
                    droppedFrames: stats.droppedFrames,
                    timestamp: now,
                    bitrate,
                };

                console.log('[QualityOptimizer] Settings adjusted:', {
                    bitrate: Math.round(bitrate / 1024) + 'kbps',
                    maxFps,
                    droppedFramesRate: Math.round(droppedFramesRate * 100) + '%',
                    networkType: networkInfo.effectiveType,
                    networkQuality: networkInfo.quality,
                    wsLatency: Math.round(networkInfo.wsLatency) + 'ms',
                    wsQualityScore: networkInfo.wsQualityScore.toFixed(2),
                });
            }
        } catch (error) {
            console.warn('[QualityOptimizer] Error during optimization:', error);
        }
    }
}
