import '../style/app.css';
import { StreamClientScrcpy } from './googDevice/client/StreamClientScrcpy';
import { HostTracker } from './client/HostTracker';
import { Tool } from './client/Tool';


window.onload = async function (): Promise<void> {
    // Redirect if the URL contains a hash fragment
    const hash = location.hash.replace(/^#!/, '');
    if (hash) {

        const parsedQuery = new URLSearchParams(hash);

        // Add `hasHash=true` to the query parameters
        // parsedQuery.set('hasHash', 'true');

        // Redirect to a query-based URL
        window.location.href = `${location.pathname}${location.search ? location.search + '&' : '?'}${parsedQuery.toString()}`;
        return; // Stop further execution
    }

    // If no hash fragment, proceed with the rest of the logic
    const parsedQuery = new URLSearchParams(location.search); // Use query parameters instead of hash
    const action = parsedQuery.get('action');

    /// #if USE_BROADWAY
    const { BroadwayPlayer } = await import('./player/BroadwayPlayer');
    StreamClientScrcpy.registerPlayer(BroadwayPlayer);
    /// #endif

    /// #if USE_H264_CONVERTER
    const { MsePlayer } = await import('./player/MsePlayer');
    StreamClientScrcpy.registerPlayer(MsePlayer);
    /// #endif

    /// #if USE_TINY_H264
    const { TinyH264Player } = await import('./player/TinyH264Player');
    StreamClientScrcpy.registerPlayer(TinyH264Player);
    /// #endif

    /// #if USE_WEBCODECS
    const { WebCodecsPlayer } = await import('./player/WebCodecsPlayer');
    StreamClientScrcpy.registerPlayer(WebCodecsPlayer);
    /// #endif

    /// #if USE_WDA_MJPEG_SERVER
    const { MjpegPlayer } = await import('./player/MjpegPlayer');
    StreamClientScrcpy.registerPlayer(MjpegPlayer);
    /// #endif

    if (action === StreamClientScrcpy.ACTION && typeof parsedQuery.get('udid') === 'string') {
        StreamClientScrcpy.start(parsedQuery);
        return;
    }

    /// #if INCLUDE_APPL
    {
        const { DeviceTracker } = await import('./applDevice/client/DeviceTracker');

        /// #if USE_QVH_SERVER
        const { StreamClientQVHack } = await import('./applDevice/client/StreamClientQVHack');

        DeviceTracker.registerTool(StreamClientQVHack);

        /// #if USE_WEBCODECS
        const { WebCodecsPlayer } = await import('./player/WebCodecsPlayer');
        StreamClientQVHack.registerPlayer(WebCodecsPlayer);
        /// #endif

        /// #if USE_H264_CONVERTER
        const { MsePlayerForQVHack } = await import('./player/MsePlayerForQVHack');
        StreamClientQVHack.registerPlayer(MsePlayerForQVHack);
        /// #endif

        if (action === StreamClientQVHack.ACTION && typeof parsedQuery.get('udid') === 'string') {
            StreamClientQVHack.start(StreamClientQVHack.parseParameters(parsedQuery));
            return;
        }
        /// #endif

        /// #if USE_WDA_MJPEG_SERVER
        const { StreamClientMJPEG } = await import('./applDevice/client/StreamClientMJPEG');
        DeviceTracker.registerTool(StreamClientMJPEG);

        const { MjpegPlayer } = await import('./player/MjpegPlayer');
        StreamClientMJPEG.registerPlayer(MjpegPlayer);

        if (action === StreamClientMJPEG.ACTION && typeof parsedQuery.get('udid') === 'string') {
            StreamClientMJPEG.start(StreamClientMJPEG.parseParameters(parsedQuery));
            return;
        }
        /// #endif
    }
    /// #endif

    const tools: Tool[] = [];

    /// #if INCLUDE_ADB_SHELL
    const { ShellClient } = await import('./googDevice/client/ShellClient');
    if (action === ShellClient.ACTION && typeof parsedQuery.get('udid') === 'string') {
        ShellClient.start(ShellClient.parseParameters(parsedQuery));
        return;
    }
    tools.push(ShellClient);
    /// #endif

    /// #if INCLUDE_DEV_TOOLS
    const { DevtoolsClient } = await import('./googDevice/client/DevtoolsClient');
    if (action === DevtoolsClient.ACTION) {
        DevtoolsClient.start(DevtoolsClient.parseParameters(parsedQuery));
        return;
    }
    tools.push(DevtoolsClient);
    /// #endif

    /// #if INCLUDE_FILE_LISTING
    const { FileListingClient } = await import('./googDevice/client/FileListingClient');
    if (action === FileListingClient.ACTION) {
        FileListingClient.start(FileListingClient.parseParameters(parsedQuery));
        return;
    }
    tools.push(FileListingClient);
    /// #endif

    if (tools.length) {
        const { DeviceTracker } = await import('./googDevice/client/DeviceTracker');
        tools.forEach((tool) => {
            DeviceTracker.registerTool(tool);
        });
    }
    HostTracker.start();
};
