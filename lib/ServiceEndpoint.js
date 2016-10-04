/*
 * Copyright (c) 2016, Bigsens, LLC
 * Service Endpoint class for manage pipes, requests and status. Support only TCP messages.
 * Author: Constantin Alexandrov
 */

'use strict';

var _ = require('underscore'),
	P = require('./protocol'),
	IMessage = require('./IMessage'),
	//protoify = require('../protoify/index.js'),
	//ByteBuffer = require('protobufjs').ByteBuffer,
	util = require('util'),
	//EventEmitter = require('events').EventEmitter,
	log4js = global.log4js,
	log = log4js.getLogger('ServiceEndpoint'),
	debug = require('debug')('ServiceEndpoint'),
	Enum = require('enum'),
	Q = require('q'),
	Dissolve = require('dissolve'),
	when = require('when'),
	aguid = require('aguid');

var Message = new Enum(P.Message),
	DeviceState = new Enum(P.DeviceState),
	DeviceType = new Enum(P.DeviceType);


// One service can have several endpoints
function ServiceEndpoint(sock, dir, opts) { // true = server->client, false = client->server
	var self = this;
	this.endpointSocket = sock;
	this.endpointSocket.setNoDelay(true);
	this.address = sock.remoteAddress+':'+sock.remotePort;

	this.dir = dir;

	this._serviceInfo = {};
	this._messageRegistry = {};

	// Endpoint id calculated during announcement with service GUID and endpoint name
	// Important: Endpoint name need to be unique in the endpoints namespace of the service
	this.id;
	this.longId;

	if(opts) {
		if(opts.name) {
			this._serviceInfo.name = opts.name; 
		}
		if(opts.guid) {
			this._serviceInfo.guid = opts.guid;
		}
		if(this._serviceInfo.name && this._serviceInfo.guid) {
			this.longId = aguid(this.getGuid()+this.getName());
			this.id = this.longId.split('-')[0];
		}
	}

	this.pendingSyncResponses = {}; // FIFO buffer for pending requests
	this.pendingSyncTimeout = 8000; // Resolve after that time if no response from service

	this.packetRef = 0;

	// Setup the bi-directional pipe between the endpoint and socket
	var streams = [ this, this.endpointSocket, this ],
		current = streams.shift(),
		next;
	while(next = streams.shift()) {
		current.pipe(next /*, { end : false } */)
			// Attach listeners to all streams
			.on('error', this._handleError.bind(this))
			.on('close', this._handleClose.bind(this))
			// For custom stream classes method end() need to be implemented
			// or 'end' opts setting to false otherwise will be exception
			// when pipe deleted, eg. client disconnect
			.on('end', function() {
				debug('No more data will be provided');
			})
			.on('finish', function() {
				debug('All data has been flushed to the underlying system');
			});
		current = next;
	}

	// Handlers name only for async methods
	this.on('SERVICE_ANNCE', this._serviceAnnouncement.bind(this));
	this.on('MESSAGE_REGISTER', this._messageRegister.bind(this));
	this.on('MESSAGE_UNREGISTER', this._messageUnregister.bind(this));
}

util.inherits(ServiceEndpoint, IMessage);

// Don't remove, method for pipe, details in constructor
ServiceEndpoint.prototype.end = function() {}

/*
 * Accessors
 */

ServiceEndpoint.prototype.getAddress = function() {
	return this.address;
}

ServiceEndpoint.prototype.getId = function() {
	return this.id;
}

ServiceEndpoint.prototype.getGuid = function() {
	return this._serviceInfo ? this._serviceInfo.guid : 'undefined';
}

ServiceEndpoint.prototype.getName = function() {
	return this._serviceInfo ? this._serviceInfo.name : 'undefined';
}

ServiceEndpoint.prototype.getInfo = function() {
	return {
		name : this.getName(),
		address : this.getAddress(),
		id : this.getId(),
		guid : this.getGuid(),
		pendingCount : this.getPendingCount()
	};
}

ServiceEndpoint.prototype.getPendingCount = function() {
	var pendingCount = 0;
	_.forEach(this.pendingSyncResponses, function(pending) {
		if(pending && pending.length) {
			pendingCount += pending.length;
		}
	});
	return pendingCount;
}

////////

ServiceEndpoint.prototype.isAlive = function() {
	var sock = this.endpointSocket;
	return (sock && !sock.destroyed);
}

ServiceEndpoint.prototype.isAnnounced = function() {
	return !!(this._serviceInfo.name && this._serviceInfo.guid);
}

ServiceEndpoint.prototype.isAllowed = function(message, endpoint) {
	var rule = this._messageRegistry[message];
	if(rule) {
		if(rule == '*') { // allowed for any endpoint
			return true;
		} else {
			if(endpoint) {
				// check if endpoint is allowed
			}
		}
	}
	return false;
}

/*
 *  Wrappers
 */

ServiceEndpoint.prototype.write = function(data) {
	debug('%s -> incomingData', this.getName());
	this.emit('packet', data);
	this.processData(data);
}

ServiceEndpoint.prototype.send = function(packet, callback) {
	var deferred = Q.defer();
	if(this.isAlive()) {
		this.endpointSocket.once('data', function() {
			deferred.resolve(this.endpointSocket.bytesWritten);
		}.bind(this));
		this.emit('data', packet);
	} else {
		deferred.reject(new Error('Socket closed'));
	}
	return deferred.promise.nodeify(callback);
}

ServiceEndpoint.prototype.closeConnection = function(err) {
	if(this.endpointSocket) {
		this.endpointSocket.destroy(err);
		this.endpointSocket = null;
		this.emit('closed', this);
	}
}

/*
 * Handlers
 */

ServiceEndpoint.prototype._handleError = function(err) {
	log.error('Socket error', err);
	this.closeConnection(err);
}

ServiceEndpoint.prototype._handleClose = function() {
	log.info('closeConnection', this.getAddress());
	this.closeConnection();
}

// Routines relative to service's entity not for endpoint class, move to separate
ServiceEndpoint.prototype._serviceAnnouncement = function(info) {

	if(this.isAnnounced()) return;

	if(info) {
		if(info.name && info.guid) {
			debug('%s -> Service announcement %j', this.getName(), info);
			log.info('Service announcement', fmtJson(info));
			this._serviceInfo = info;
			this.longId = aguid(this.getGuid()+this.getName());
			this.id = this.longId.split('-')[0];
		} else {
			var errmsg = 'No mandatory fields \'name\' and/or \'guid\'';
			debug('_serviceAnnouncement', errmsg);
			// send error to service end close connection
			this.closeConnection(new Error(errmsg));
		}
	} else {
		var errmsg = 'Description is empty';
		debug('_serviceAnnouncement', errmsg);
		// send error to service end close connection
		this.closeConnection(new Error(errmsg));
	}
}

ServiceEndpoint.prototype._messageRegister = function(messages) {
	this._messageRegistry = _.extend(this._messageRegistry, messages);
}

ServiceEndpoint.prototype._messageUnregister = function(messages) {
	this._messageRegistry = _.keys(messages).reduce(function(obj, key) {
		delete obj[key];
		return obj;
	}, this._messageRegistry).value();
	debug('%s -> _messageUnregister => %j', this.getName(), this._messageRegistry);
}

/*
 * Message receivers
 */

ServiceEndpoint.prototype.processData = function(message) {
	var length = message.length,
		remainingMessage = message,
		used;
	do {
		used = this._processIncomingMessage(remainingMessage);
		remainingMessage = remainingMessage.slice(used);
		debug('Read message length ', used, 'of', length, '. ', remainingMessage.length,' remaining.');
	} while(remainingMessage.length && used > 0);
}

ServiceEndpoint.prototype._processIncomingMessage = function(packet) {

	//var chunks = packet.toString().split('}{');
	var chunks = packet.toString().split('\n');
	if(chunks.length >= 1) {
		//packet=chunks.shift()+'}'
		packet=chunks.shift(); 
	}
	var used=packet.length;
	if(packet == "") return used;

	try {

		this.packetRef++;

		packet = _decodeMessage(packet);

		if(!packet) return;

		var messageId = packet.cmd,
			data = packet.data,
			hadListeners = false,
			message = Message.get(messageId);

		// Add source address to the packet.
		if(!packet.src) {
			packet.src = this.getAddress();
		}

		debug('%s -> _processIncomingMessage(%j)', this.getName(), packet);

		if(message) {
			//if(packet.dir) { // Pass request responses
				debug('%s -> emit(\'request:%s\', %j)', this.getName(), message.key, data);
				hadListeners = this.emit('request:' + message.key, data);
				
				/*if(!hadListeners) {
					this.emit('unhandledPacket', packet);
				}*/

				if(!hadListeners) { //packet.dir) {
					// Pass messages and requests
					if(packet.src == this.getAddress()) {
						this.emit(message.key, data);
					}
					this.emit('received', packet);
				}
			//}
		} else {
			log.warn('processIncomingMessage', 'Message with id %s not found', messageId);
		}

		/*
		// Service messages only for the Service Gateway
		if(messageId == Message.SERVICE_ANNCE
			|| messageId == Message.SERVICE_READY) {

			this.emit('message:' + message.key, data);

		} else if(!packet.dir) {
			// Pass messages and requests
			this.emit('onReceive', packet);
		}*/

		this.packetRef = 0;

	}

	catch(err) {
		if(this.packetRef < 3) {
			//var chunks = packet.toString().split('}{'),
			var chunks = packet.toString().split('\n'),
				packet = chunks[chunks.length-1];
				//packet = '{'+chunks[chunks.length-1];
			this._processIncomingMessage(packet);
		} else {
			//log.error('_processIncomingMessage', err);
			debug('%s -> _processIncomingMessage, packet = %s, error = %s',
				this.getName(), packet, err);
			this.packetRef = 0;
			used = 0;
		}
	}

	return used;

}

/*
 * Message senders
 */

ServiceEndpoint.prototype.sendMessage = function(messageName, data, callback) {
	var deferred = Q.defer();
	//if(!_.isUndefined(dir) && _.isFunction(dir)) { callback = dir; }
	try {
		var type = Object.prototype.toString.call(messageName)
			.replace(/^\[object |\]$/g, '').toLowerCase(),
			message = messageName;
		if(type == 'string') {
			message = Message[messageName];
			if(!message) {
				log.error('Message with name %s not found', messageName);
			}
		}
		debug('%s -> sendMessage(%s, %j)', this.getName(), message.key, data);
		var packet = { cmd : message.value, data : data };
		packet = _encodeMessage(packet);
		packet += '\n';
		//this.send(packet);
		//this.emit('onSend', packet);
		
		//deferred.resolve();

		this.send(packet).then(function(bytesCount) {
			this.emit('onSend', packet);
			deferred.resolve(packet, bytesCount);
		}.bind(this)).fail(function(err) { deferred.reject(err); }).done();
	}
	catch(err) {
		log.error('sendMessage', err);
	}
	return deferred.promise.nodeify(callback);
}

ServiceEndpoint.prototype.syncRequest = function(messageName, data) {

	if (!data) {
		data = {};
	}

	debug('%s -> syncRequest(%s, %j)', this.getName(), messageName, data);

	var message = Message[messageName];
	if(!message) {
		log.error('Message with name %s not found', messageName);
	}
	var deferred = when.defer();

	var releasePending = function() {
		this.pendingSyncResponses[message.key].shift();
	}.bind(this);

	if(!this.pendingSyncResponses[message.key]) {
		this.pendingSyncResponses[message.key] = [];
		this.on('request:' + message.key, function(response) {
			try {
				debug('catch response %j from %s', response, this.getName());
				this.pendingSyncResponses[message.key].shift()(response);
			}
			catch(err) {
				// Conflict when client send message not linked with the message from server
				// TypeError: this.pendingSyncResponses[message.key].shift(...) is not a function
				log.error('%s -> request error %j', this.getName(), err);
				debug('%s -> pendingSyncResponses = %j',
					this.getName(),
					this.pendingSyncResponses);
				debug('%s -> pendingSyncResponses[%s].shift()(%j)',
					this.getName(),
					message.key,
					response);
			}
		}.bind(this));
	}

	this.pendingSyncResponses[message.key].push(function(response) {
		deferred.resolve(response);
	});

	this.sendMessage(message, data).fail(function(err) {
		deferred.reject(err);
	}).done(); //, this.dir);

	return deferred.promise
		.timeout(this.pendingSyncTimeout)
		.catch(releasePending);
}

ServiceEndpoint.prototype.asyncRequest = function(messageName, data) {
	// TODO
}


/*
 * Utils
 */

// data packing routines
var _decodeMessage = function(data) {
	return JSON.parse(data);
}

var _encodeMessage = function(data) {
	return JSON.stringify(data);
}

// other routines
function fmtJson(json) {
	return JSON.stringify(json, null, 2);
}

module.exports = ServiceEndpoint;

