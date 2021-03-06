'use strict';

const axon = require('axon');
const exists = require('fs').existsSync;
const ip = require('ip');
const is = require('is_js');
const joinPath = require('path').join;
const portfinder = require('portfinder');
const readdir = require('fs').readdirSync;

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

        const files = readdir(dir);
        for (let file of files)
            this.addService(require(joinPath(dir, file)));
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
            if (is.not.string(path) || is.empty(path)) return reply('INVALID_PATH');

            const delimiter = this.options.delimiter;
            path = path.split(is.string(delimiter) && is.not.empty(delimiter) ? delimiter : '.');

            const service = path.shift(), method = path.shift();
            if (!this._services[service]) {
                switch (service) {
                case this.COMMAND_CLEAN_SHUTDOWN:
                    return this.shutdown();
                default:
                    return reply('INVALID_SERVICE');
                }
            } else if (!method || is.empty(method)) return reply('MISSING_METHOD');
            else if (method.charAt(0) === '_') return reply('INVALID_METHOD');
            else if (!this._services[service][method]) return reply('INVALID_METHOD');
            else if (is.not.function(this._services[service][method])) return reply('INVALID_METHOD');

            const p = this._services[service][method](payload, reply);
            if (p instanceof Promise)
                p.then(r => r !== undefined && reply(r))
                    .catch(e => {
                        if (this.options.debug) console.log(e);
                    });
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
            if (this.options.debug) console.log(`ready on #${ this.options.port }`);
            this.advertise({
                advertisement: {
                    port: this.options.port,
                    group: this.options.group,
                    services: Object.keys(this._services)
                }
            });
        });
        this._socket.on('error', e => {
            if (this.options.debug) console.log(e);
        });
        this._socket.on('connect', s => {
            if (this.options.debug) console.log(`${ s._peername.address } connected`);
        });
        this._socket.on('disconnect', s => {
            if (this.options.debug) console.log(`${ s._peername.address } disconnected`);
        });
        this._onMessage();
    }

    /**
     * @description returns advertising payload
     * @returns {string}
     * @access private
     * @memberof Server
     */
    __payload() {
        return JSON.stringify({
            address: ip.address(this.options.iface),
            advertisement: {
                port: this.options.port,
                group: this.options.group,
                services: Object.keys(this._services)
            }
        });
    }

    /**
     * @description stops the server instance
     * @memberof Server
     */
    shutdown() {
        if (this.ad) this.ad.stop();
        this._socket.close();
        if (this.interval) clearInterval(this.interval);
        if (this.options.debug) console.log('server closed');
    }
}

module.exports = Server;
