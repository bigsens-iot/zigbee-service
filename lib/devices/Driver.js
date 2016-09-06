/*
 * Copyright (c) 2016, Bigsens, LLC
 * Driver is the parent class for all ZigBee devices
 * Author: Constantin Alexandrov
 */

'use strict';

var _ = require('underscore'),
	Q = require('q'),
	log4js = global.log4js,
	log = log4js.getLogger('Driver'),
	debug = require('debug')('Driver'),
	util = require('util'),
	EventEmitter = require('events').EventEmitter,
	Concentrate = require('concentrate'),
	DeviceType = require('../service/protocol').DeviceType,
	aguid = require('aguid');


function Driver(dev)  {
	this.dev = dev;
	this.guid;
	if(dev.ieeeAddr) {
		this.guid = aguid(dev.ieeeAddr);
	} else {
		log.warn('Device ieee address not found.');
	}
	this.type;
	this.attributes = {};
}

util.inherits(Driver, EventEmitter);


Driver.prototype.info = function() {
	return {
		guid : this.guid, // device unique id
		type : this.type, // device type, see protocol.js -> DeviceTypes
		status : this.dev.status, // unknown, offline, online
		attributes : {}, // attributes types and values
		methods : {} // device methods
	};
}

Driver.prototype.extendedInfo = function() {
	// Protocol depended information about device
	return _.extend(this.info(), {spec:this.dev.dump()});
}

Driver.prototype.getDev = function() {
	return this.dev;
}

Driver.prototype.getGuid = function() {
	return this.guid;
}

Driver.prototype.readAttribute = function(endpoint, cluster, attr, callback) {
	var deferred = Q.defer();
	if(this.dev && this.dev.status == 'online') {
		endpoint.foundation(cluster, 'read', [ { attrId: attr } ])
			.then(function(rsp) {
				if(rsp && rsp.length === 1) {
					this.emit('readAttribute', this, cluster, attr, rsp[0].attrData);
					deferred.resolve(this.dev, cluster, attr, rsp[0].attrData);
				}
			}.bind(this))
			.fail(function(err) {
				log.error('Read attribute', err);
				deferred.reject(err);
			}).done();
	} else {
		deferred.reject();
	}
	return deferred.promise.nodeify(callback);
}

Driver.prototype.cleanup = function() {
	this.removeAllListeners('reportAttribute');
	if(this.clearPolls) {
		this.clearPolls();
	}
}

module.exports = Driver;

