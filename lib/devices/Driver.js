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
	aguid = require('aguid'),
	zclId = require('zcl-id');


function Driver(dev)  {
	this.dev = dev;
	this.guid = dev.ieeeAddr ? aguid(dev.ieeeAddr) : aguid();
	this.type;
	this.attributes = {};
	this.methods = {};
}

util.inherits(Driver, EventEmitter);


Driver.prototype.info = function() {
	return {
		guid : this.guid, // device unique id
		type : this.type, // device type, see protocol.js -> DeviceTypes
		status : this.dev.status, // unknown, offline, online
		attributes : this.attributes, // attributes names and values
		methods : this.methods // supported methods
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

Driver.prototype.getType = function() {
	return { key : DeviceType.inverted[this.type], value : this.type };
}

Driver.prototype._setAttr = function(cluster, attr, value) {
	if(_.isNumber(attr)) {
		attr = zclId.attr(cluster, attr);
	}
	this.attributes[attr.key || attr] = value;
	// need cluster.attr
}

Driver.prototype.readAttribute = function(endpoint, cluster, attr, callback) {
	var deferred = Q.defer();
	if(this.dev && this.dev.status == 'online') {
		endpoint.foundation(cluster, 'read', [ { attrId: attr } ])
			.then(function(rsp) {
				if(rsp && rsp.length === 1) {
					var value = rsp[0].attrData;
					this._setAttr(cluster, attr, value);
					this.emit('readAttribute', this, cluster, attr, value);
					deferred.resolve(this.dev, cluster, attr, value);
				}
			}.bind(this))
			.fail(function(err) {
				log.error('Device %s read attribute %s error %j', this.getType().key, attr, err);
				deferred.reject(err);
			}.bind(this)).done();
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

//other routines
function fmtJson(json) {
	return JSON.stringify(json, null, 2);
}

module.exports = Driver;

