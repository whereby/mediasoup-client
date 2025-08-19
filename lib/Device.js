"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Device = void 0;
exports.detectDeviceAsync = detectDeviceAsync;
exports.detectDevice = detectDevice;
const ua_parser_js_1 = require("ua-parser-js");
const Logger_1 = require("./Logger");
const enhancedEvents_1 = require("./enhancedEvents");
const errors_1 = require("./errors");
const utils = require("./utils");
const ortc = require("./ortc");
const Transport_1 = require("./Transport");
const Chrome111_1 = require("./handlers/Chrome111");
const Chrome74_1 = require("./handlers/Chrome74");
const Firefox120_1 = require("./handlers/Firefox120");
const Safari12_1 = require("./handlers/Safari12");
const ReactNative106_1 = require("./handlers/ReactNative106");
const logger = new Logger_1.Logger('Device');
/**
 * Async mediasoup-client Handler detection. More powerful than
 * `detectDevice()`.
 */
async function detectDeviceAsync(userAgent) {
    logger.debug('detectDeviceAsync() [userAgent:%s]', userAgent);
    if (!userAgent && typeof navigator === 'object') {
        userAgent = navigator.userAgent;
    }
    const uaParserResult = await (0, ua_parser_js_1.UAParser)(userAgent).withFeatureCheck();
    return detectDeviceImpl(uaParserResult);
}
/**
 * Sync mediasoup-client Handler detection.
 *
 * @deprecated It only relies on navigator.userAgent. Use `detectDeviceAsync()`
 * instead.
 */
function detectDevice(userAgent) {
    logger.debug('detectDevice() [userAgent:%s]', userAgent);
    if (!userAgent && typeof navigator === 'object') {
        userAgent = navigator.userAgent;
    }
    const uaParserResult = (0, ua_parser_js_1.UAParser)(userAgent);
    return detectDeviceImpl(uaParserResult);
}
class Device {
    // RTC handler factory.
    _handlerFactory;
    // Handler name.
    _handlerName;
    // Loaded flag.
    _loaded = false;
    // Callback for sending Transports to request sending extended RTP capabilities
    // on demand.
    _getSendExtendedRtpCapabilities;
    // Local RTP capabilities for receiving media.
    _recvRtpCapabilities;
    // Whether we can produce audio/video based on remote RTP capabilities.
    _canProduceByKind = {
        audio: false,
        video: false,
    };
    // Local SCTP capabilities.
    _sctpCapabilities;
    // Observer instance.
    _observer = new enhancedEvents_1.EnhancedEventEmitter();
    /**
     * Create a new Device to connect to mediasoup server. It uses a more advanced
     * device detection.
     *
     * @throws {UnsupportedError} if device is not supported.
     */
    static async factory({ handlerName, handlerFactory, } = {}) {
        logger.debug('factory()');
        if (handlerName && handlerFactory) {
            throw new TypeError('just one of handlerName or handlerInterface can be given');
        }
        if (!handlerName && !handlerFactory) {
            handlerName = await detectDeviceAsync();
            if (!handlerName) {
                throw new errors_1.UnsupportedError('device not supported');
            }
        }
        return new Device({ handlerName, handlerFactory });
    }
    /**
     * Create a new Device to connect to mediasoup server.
     *
     * @throws {UnsupportedError} if device is not supported.
     */
    constructor({ handlerName, handlerFactory } = {}) {
        logger.debug('constructor()');
        if (handlerName && handlerFactory) {
            throw new TypeError('just one of handlerName or handlerInterface can be given');
        }
        if (handlerFactory) {
            this._handlerFactory = handlerFactory;
        }
        else {
            if (handlerName) {
                logger.debug('constructor() | handler given: %s', handlerName);
            }
            else {
                handlerName = detectDevice();
                if (handlerName) {
                    logger.debug('constructor() | detected handler: %s', handlerName);
                }
                else {
                    throw new errors_1.UnsupportedError('device not supported');
                }
            }
            switch (handlerName) {
                case 'Chrome111': {
                    this._handlerFactory = Chrome111_1.Chrome111.createFactory();
                    break;
                }
                case 'Chrome74': {
                    this._handlerFactory = Chrome74_1.Chrome74.createFactory();
                    break;
                }
                case 'Firefox120': {
                    this._handlerFactory = Firefox120_1.Firefox120.createFactory();
                    break;
                }
                case 'Safari12': {
                    this._handlerFactory = Safari12_1.Safari12.createFactory();
                    break;
                }
                case 'ReactNative106': {
                    this._handlerFactory = ReactNative106_1.ReactNative106.createFactory();
                    break;
                }
                default: {
                    throw new TypeError(`unknown handlerName "${handlerName}"`);
                }
            }
        }
        this._handlerName = this._handlerFactory.name;
    }
    /**
     * The RTC handler name.
     */
    get handlerName() {
        return this._handlerName;
    }
    /**
     * Whether the Device is loaded.
     */
    get loaded() {
        return this._loaded;
    }
    /**
     * RTP capabilities of the Device for receiving media.
     *
     * @throws {InvalidStateError} if not loaded.
     */
    get rtpCapabilities() {
        if (!this._loaded) {
            throw new errors_1.InvalidStateError('not loaded');
        }
        return this._recvRtpCapabilities;
    }
    /**
     * SCTP capabilities of the Device.
     *
     * @throws {InvalidStateError} if not loaded.
     */
    get sctpCapabilities() {
        if (!this._loaded) {
            throw new errors_1.InvalidStateError('not loaded');
        }
        return this._sctpCapabilities;
    }
    get observer() {
        return this._observer;
    }
    /**
     * Initialize the Device.
     */
    async load({ routerRtpCapabilities, preferLocalCodecsOrder = false, }) {
        logger.debug('load() [routerRtpCapabilities:%o]', routerRtpCapabilities);
        if (this._loaded) {
            throw new errors_1.InvalidStateError('already loaded');
        }
        // Clone given router RTP capabilities to not modify input data.
        const clonedRouterRtpCapabilities = utils.clone(routerRtpCapabilities);
        // This may throw.
        ortc.validateRtpCapabilities(clonedRouterRtpCapabilities);
        const { getNativeRtpCapabilities, getNativeSctpCapabilities } = this._handlerFactory;
        const clonedNativeRtpCapabilities = utils.clone(await getNativeRtpCapabilities());
        // This may throw.
        ortc.validateRtpCapabilities(clonedNativeRtpCapabilities);
        logger.debug('load() | got native RTP capabilities:%o', clonedNativeRtpCapabilities);
        this._getSendExtendedRtpCapabilities = (nativeRtpCapabilities) => {
            return utils.clone(ortc.getExtendedRtpCapabilities(nativeRtpCapabilities, clonedRouterRtpCapabilities, preferLocalCodecsOrder));
        };
        const recvExtendedRtpCapabilities = ortc.getExtendedRtpCapabilities(clonedNativeRtpCapabilities, clonedRouterRtpCapabilities, 
        /* preferLocalCodecsOrder */ false);
        // Generate our receiving RTP capabilities for receiving media.
        this._recvRtpCapabilities = ortc.getRecvRtpCapabilities(recvExtendedRtpCapabilities);
        // This may throw.
        ortc.validateRtpCapabilities(this._recvRtpCapabilities);
        logger.debug('load() | got receiving RTP capabilities:%o', this._recvRtpCapabilities);
        // Check whether we can produce audio/video.
        this._canProduceByKind.audio = ortc.canSend('audio', this._recvRtpCapabilities);
        this._canProduceByKind.video = ortc.canSend('video', this._recvRtpCapabilities);
        // Generate our SCTP capabilities.
        this._sctpCapabilities = await getNativeSctpCapabilities();
        // This may throw.
        ortc.validateSctpCapabilities(this._sctpCapabilities);
        logger.debug('load() | got native SCTP capabilities:%o', this._sctpCapabilities);
        logger.debug('load() succeeded');
        this._loaded = true;
    }
    /**
     * Whether we can produce audio/video.
     *
     * @throws {InvalidStateError} if not loaded.
     * @throws {TypeError} if wrong arguments.
     */
    canProduce(kind) {
        if (!this._loaded) {
            throw new errors_1.InvalidStateError('not loaded');
        }
        else if (kind !== 'audio' && kind !== 'video') {
            throw new TypeError(`invalid kind "${kind}"`);
        }
        return this._canProduceByKind[kind];
    }
    /**
     * Creates a Transport for sending media.
     *
     * @throws {InvalidStateError} if not loaded.
     * @throws {TypeError} if wrong arguments.
     */
    createSendTransport({ id, iceParameters, iceCandidates, dtlsParameters, sctpParameters, iceServers, iceTransportPolicy, additionalSettings, appData, }) {
        logger.debug('createSendTransport()');
        return this.createTransport({
            direction: 'send',
            id,
            iceParameters,
            iceCandidates,
            dtlsParameters,
            sctpParameters,
            iceServers,
            iceTransportPolicy,
            additionalSettings,
            appData,
        });
    }
    /**
     * Creates a Transport for receiving media.
     *
     * @throws {InvalidStateError} if not loaded.
     * @throws {TypeError} if wrong arguments.
     */
    createRecvTransport({ id, iceParameters, iceCandidates, dtlsParameters, sctpParameters, iceServers, iceTransportPolicy, additionalSettings, appData, }) {
        logger.debug('createRecvTransport()');
        return this.createTransport({
            direction: 'recv',
            id,
            iceParameters,
            iceCandidates,
            dtlsParameters,
            sctpParameters,
            iceServers,
            iceTransportPolicy,
            additionalSettings,
            appData,
        });
    }
    createTransport({ direction, id, iceParameters, iceCandidates, dtlsParameters, sctpParameters, iceServers, iceTransportPolicy, additionalSettings, appData, }) {
        if (!this._loaded) {
            throw new errors_1.InvalidStateError('not loaded');
        }
        else if (typeof id !== 'string') {
            throw new TypeError('missing id');
        }
        else if (typeof iceParameters !== 'object') {
            throw new TypeError('missing iceParameters');
        }
        else if (!Array.isArray(iceCandidates)) {
            throw new TypeError('missing iceCandidates');
        }
        else if (typeof dtlsParameters !== 'object') {
            throw new TypeError('missing dtlsParameters');
        }
        else if (sctpParameters && typeof sctpParameters !== 'object') {
            throw new TypeError('wrong sctpParameters');
        }
        else if (appData && typeof appData !== 'object') {
            throw new TypeError('if given, appData must be an object');
        }
        // Create a new Transport.
        const transport = new Transport_1.Transport({
            direction,
            id,
            iceParameters,
            iceCandidates,
            dtlsParameters,
            sctpParameters,
            iceServers,
            iceTransportPolicy,
            additionalSettings,
            appData,
            handlerFactory: this._handlerFactory,
            getSendExtendedRtpCapabilities: this._getSendExtendedRtpCapabilities,
            recvRtpCapabilities: this._recvRtpCapabilities,
            canProduceByKind: this._canProduceByKind,
        });
        // Emit observer event.
        this._observer.safeEmit('newtransport', transport);
        return transport;
    }
}
exports.Device = Device;
function detectDeviceImpl(uaParserResult) {
    // React-Native.
    if (typeof navigator === 'object' && navigator.product === 'ReactNative') {
        logger.debug('detectDeviceImpl() | React-Native detected');
        if (typeof RTCPeerConnection === 'undefined' ||
            typeof RTCRtpTransceiver === 'undefined') {
            logger.warn('detectDeviceImpl() | unsupported react-native-webrtc without RTCPeerConnection or RTCRtpTransceiver, forgot to call registerGlobals() on it?');
            return undefined;
        }
        return 'ReactNative106';
    }
    // Browser.
    else {
        logger.debug('detectDeviceImpl() | browser detected [userAgent:%s, parsed:%o]', uaParserResult.ua, uaParserResult);
        const browser = uaParserResult.browser;
        const browserName = browser.name?.toLowerCase();
        const browserVersion = parseInt(browser.major ?? '0');
        const engine = uaParserResult.engine;
        const engineName = engine.name?.toLowerCase();
        const os = uaParserResult.os;
        const osName = os.name?.toLowerCase();
        const osVersion = parseFloat(os.version ?? '0');
        const device = uaParserResult.device;
        const deviceModel = device.model?.toLowerCase();
        const isIOS = osName === 'ios' || deviceModel === 'ipad';
        const isChrome = browserName &&
            [
                'chrome',
                'chromium',
                'mobile chrome',
                'chrome webview',
                'chrome headless',
            ].includes(browserName);
        const isFirefox = browserName &&
            ['firefox', 'mobile firefox', 'mobile focus'].includes(browserName);
        const isSafari = browserName && ['safari', 'mobile safari'].includes(browserName);
        const isEdge = browserName && ['edge'].includes(browserName);
        // Chrome, Chromium, and Edge.
        if ((isChrome || isEdge) && !isIOS && browserVersion >= 111) {
            return 'Chrome111';
        }
        else if ((isChrome && !isIOS && browserVersion >= 74) ||
            (isEdge && !isIOS && browserVersion >= 88)) {
            return 'Chrome74';
        }
        // Firefox.
        else if (isFirefox && !isIOS && browserVersion >= 120) {
            return 'Firefox120';
        }
        // Firefox on iOS (so Safari).
        else if (isFirefox && isIOS && osVersion >= 14.3) {
            return 'Safari12';
        }
        // Safari with Unified-Plan support enabled.
        else if (isSafari &&
            browserVersion >= 12 &&
            typeof RTCRtpTransceiver !== 'undefined' &&
            RTCRtpTransceiver.prototype.hasOwnProperty('currentDirection')) {
            return 'Safari12';
        }
        // Best effort for WebKit based browsers in iOS.
        else if (engineName === 'webkit' &&
            isIOS &&
            typeof RTCRtpTransceiver !== 'undefined' &&
            RTCRtpTransceiver.prototype.hasOwnProperty('currentDirection')) {
            return 'Safari12';
        }
        // Best effort for Chromium based browsers.
        else if (engineName === 'blink') {
            // eslint-disable-next-line @typescript-eslint/prefer-regexp-exec
            const match = uaParserResult.ua.match(/(?:(?:Chrome|Chromium))[ /](\w+)/i);
            if (match) {
                const version = Number(match[1]);
                if (version >= 111) {
                    return 'Chrome111';
                }
                else {
                    return 'Chrome74';
                }
            }
            else {
                return 'Chrome111';
            }
        }
        // Unsupported browser.
        else {
            logger.warn('detectDeviceImpl() | browser not supported [name:%s, version:%s]', browserName, browserVersion);
            return undefined;
        }
    }
}
