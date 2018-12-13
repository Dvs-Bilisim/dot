'use strict';

const axon = require('axon');
const exists = require('fs').existsSync;
const is = require('is_js');
const joinPath = require('path').join;
const portfinder = require('portfinder');
const readdir = require('fs').readdir;
const shortid = require('shortid');

const Base = require('./base');

/**
 * @class Server
 * @extends {Base}
 */
class Server extends Base {
    /**
     *Creates an instance of Server.
     * @param {Object} [options={}]
     * @memberof Server
     */
    constructor(options = {}) {
        super(Object.assign({ shutdown: 5000 }, options));

        this._flag = { l: false, m: false, s: false };
        this._lock = false;
        this._services = {};
        this._socket = axon.socket('rep');
        this._listen();
    }

    /**
     * @description Registers a service class
     * @param {Class} service
     * @throws Error
     * @memberof Server
     */
    addService(service) {
        if (is.not.function(service)) throw new Error('service must be a class');

        const name = this.fixServiceName(service);
        this._services[name] = service;
    }

    /**
     * @description Registers a list of service classes
     * @param {Array} services
     * @throws Error
     * @memberof Server
     */
    addServices(services) {
        if (is.not.array(services)) throw new Error('you must provide an array of services');

        for (let service of services) this.addService(service);
    }

    /**
     * @description Registers
     * @param {String} dir full path
     * @throws Error
     * @memberof Server
     */
    addPath(dir) {
        if (is.not.string(dir)) throw new Error('you must provide a path to service classes');
        else if (!exists(dir)) throw new Error('invalid path');

        readdir(dir, (error, files) => {
            if (error) throw error;

            for (let file of files)
                this.addService(require(joinPath(dir, file)));
        });
    }

    /**
     * @description Starts server instance
     * @param {Function} cbErr callback for error only
     * @memberof Server
     */
    start(cbErr) {
        if (this._flag.s) cbErr(new Error('already started'));

        this._flag.s = true;
        portfinder.getPortPromise({
            port: is.number(this.options.port) && this.options.port > 0 ? this.options.port : undefined
        }).then(port => {
            this.options.port = port;
            this._socket.bind(this.options.port);
        }).catch(error => {
            if (is.function(cbErr)) cbErr(error);
        });
    }

    /**
     * @description Handles incoming messages to server socket
     * @throws Error
     * @access private
     * @memberof Server
     */
    _onMessage() {
        if (this._flag.m) throw new Error('already listening');

        this._flag.m = true;
        this._socket.on('message', (path, payload, reply) => {
            if (this._lock) return reply('LOCKED'); // clean shutdown on progress
            if (is.not.string(path) || is.empty(path)) return reply('INVALID_PATH');

            const delimiter = this.options.delimiter;
            path = path.split(is.string(delimiter) && is.not.empty(delimiter) ? delimiter : '.');

            const service = path.shift(), method = path.shift();
            if (!this._services.hasOwnProperty(service)) {
                if (service === this.COMMAND_CLEAN_SHUTDOWN) {
                    this._lock = true;
                    const shutdown = this.options.shutdown;
                    let waitUntil = is.number(shutdown) && shutdown > 0 ? shutdown : 1000;
                    if (is.object(payload) && is.number(payload.shutdown)) waitUntil = payload.shutdown;
                    this.warning(`clean shutdown in ${ waitUntil } miliseconds...`);
                    setTimeout(() => {
                        if (this.ad) this.ad.stop();
                        this._socket.close();
                        this.success('server closed');
                    }, waitUntil);
                    return reply({ cmd: '#KILL', s: true });
                } else return reply('INVALID_SERVICE');
            } else if (!method || is.empty(method)) return reply('MISSING_METHOD');
            else if (method.charAt(0) === '_') return reply('INVALID_METHOD');
            else if (!this._services[service].hasOwnProperty(method)) return reply('INVALID_METHOD');
            else if (is.not.function(this._services[service][method])) return reply('INVALID_METHOD');

            this._services[service][method](payload, reply);
        });
    }

    /**
     * @description Binds all required listeners
     * @throws Error
     * @access private
     * @memberof Server
     */
    _listen() {
        if (this._flag.l) throw new Error('already listening');

        this._flag.l = true;
        this._socket.on('bind', () => {
            this.success(`ready on #${ this.options.port }`);
            this.advertise({
                advertisement: {
                    port: this.options.port,
                    group: this.options.group,
                    services: Object.keys(this._services)
                }
            });
        });
        this._socket.on('error', error => {
            this.fail(error);
        });
        this._socket.on('connect', s => {
            s._id = shortid();
            if (s._peername && s._peername.address) s._ip = s._peername.address;
            this.success(`${ s._id }@${ s._ip } connected`);
        });
        this._socket.on('disconnect', s => {
            this.warning(`${ s._id }@${ s._ip } disconnected`);
        });
        this._onMessage();
    }
}

module.exports = Server;