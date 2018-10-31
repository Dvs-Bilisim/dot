'use strict';

const axon = require('axon');
const is = require('is_js');

const Base = require('./base');

class Client extends Base {
    constructor(options) {
        super(options);

        this._flag = { f: false };
        this._messages = [];
        this._sockets = {};
        this.advertise({ client: true }, this._serviceFound.bind(this), this._serviceLost.bind(this));
    }

    _serviceFound(ad) {
        if (!ad.hasOwnProperty('advertisement') || is.not.object(ad.advertisement)) return;
        else if (is.not.number(ad.advertisement.port)) return;
        else if (is.not.string(ad.address) || is.not.ip(ad.address)) return;
        else if (is.not.array(ad.advertisement.services) || is.empty(ad.advertisement.services)) return;

        if (is.string(this.options.group) && is.not.empty(this.options.group))
            if (this.options.group !== ad.advertisement.group) {
                this._dequeue();
                return;
            }

        this.success(ad);
        const socket = axon.socket('req');
        socket.connect(ad.advertisement.port, ad.address);

        for (let service of ad.advertisement.services) {
            if (!this._sockets.hasOwnProperty(service)) this._sockets[service] = {};
            if (!this._sockets[service].hasOwnProperty(ad.id))
                this._sockets[service][ad.id] = socket;
        }
        this._dequeue();
    }

    _serviceLost(ad) {
        if (!ad.hasOwnProperty('advertisement') || is.not.object(ad.advertisement)) return;
        else if (is.not.number(ad.advertisement.port)) return;
        else if (is.not.array(ad.advertisement.services) || is.empty(ad.advertisement.services)) return;

        this.warning(ad);
        for (let service of ad.advertisement.services) {
            if (this._sockets.hasOwnProperty(service))
                if (this._sockets[service].hasOwnProperty(ad.id)) {
                    try {
                        this._sockets[service][ad.id].close();
                    } catch(e) {
                        this.fail(e.toString());
                    }
                    delete this._sockets[service][ad.id];
                }
        }
    }

    _getSocket(service) {
        if (!this._sockets.hasOwnProperty(service)) return null;

        const sockets = Object.keys(this._sockets[service]);
        if (!sockets.length) return null;

        return this._sockets[service][sockets[Math.floor(Math.random() * sockets.length)]];
    }

    _enqueue(request) {
        if (is.not.array(request) || request.length < 3)
            throw new Error('request must be an array with at least 3 items: path, payload, callback');
        else if (is.not.function(request[2]))
            throw new Error('callback (2nd item) must be a function');

        if (request.length === 3) request.push(Date.now());
        else if (is.not.number(request[3]) || request[3] <= 0) request[3] = Date.now();
        this._messages.push(request);
    }

    _dequeue() {
        if (!this._messages.length) return this._flag.f = false;
        else if (this._flag.f) return;

        this._flag.f = true;
        const message = this._messages.shift();
        const delay = this.options.delay;
        if (is.number(delay) && delay > 0)
            if (Date.now() - message[3] < delay)
                process.nextTick(() => this.send(message[0], message[1], message[2], message[3]));
            else message[2](new Error('SERVICE_TIMEOUT'));

        setTimeout(() => {
            this._flag.f = false;
            this._dequeue();
        }, 20);
    }

    send(path, payload, cb, timestamp = 0) {
        if (is.not.string(path) || is.empty(path)) return cb(new Error('INVALID_PATH'));

        const delimiter = this.options.delimiter;
        const delay = this.options.delay;
        const timeout = this.options.timeout;
        const service = path.split(is.string(delimiter) && is.not.empty(delimiter) ? delimiter : '.').shift();
        const socket = this._getSocket(service);
        if (socket) {
            let t_o = null;
            try {
                if (is.number(timeout) && timeout > 0)
                    t_o = setTimeout(() => {
                        t_o = null;
                        cb(new Error('REQUEST_TIMEOUT'));
                    }, timeout);
                socket.send(path, payload, response => {
                    if (t_o) {
                        clearTimeout(t_o);
                        if (is.existy(response) && is.not.string(response)) return cb(response);

                        cb(new Error(is.empty(response) ? 'INVALID_RESPONSE' : new Error(response)));
                    }
                });
            } catch(e) {
                this.fail(e.toString());
                cb(e);
            }
        }
        else if (is.number(delay) && delay > 0)
            this._enqueue([ path, payload, cb, timestamp > 0 ? timestamp : 0 ]);
        else cb(new Error('INVALID_SERVICE'));
    }

    disconnect() {
        for (let service of Object.keys(this._sockets))
            for (let id of Object.keys(this._sockets[service])) {
                this._sockets[service][id].close();
                this.warning(`${ service } @ ${ id } closed`);
            }
    }
}

module.exports = Client;