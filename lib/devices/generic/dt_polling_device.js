/*
 * Copyright (c) 2016, Bigsens, LLC
 * Polling device
 * Author: Constantin Alexandrov
 */

'use strict';

var _ = require('underscore'),
	Q = require('q'),
	log4js = global.log4js,
	log = log4js.getLogger('PollingDevice'),
	debug = require('debug')('PollingDevice'),
	util = require('util'),
	DeviceType = require('../../service/protocol').DeviceType,
	Driver = require('../Driver'),
	zclId = require('zcl-id');

function PollingDevice(dev) {
	PollingDevice.super_.apply(this, arguments);
	this.attrTimers = {}; // key: attr, value: timer
	this.on('readAttribute', function(device, cluster, attr, value) {
		this.emit('reportAttribute', device, cluster, attr, value);
	}.bind(this));
}

util.inherits(PollingDevice, Driver);

PollingDevice.prototype.reportAttribute = function(endpoint, cluster, attr, intval) {
	var attr = zclId.attr(cluster, attr).key,
		timer = this.attrTimers[attr],
		repIntval = intval || 10;
	if(timer) {
		clearInterval(timer);
		delete this.attrTimers[attr];
	}
	this.configReport(endpoint, cluster, attr, repIntval).fail(function(err) {
		timer = setInterval(this.readAttribute.bind(this, endpoint, cluster, attr), repIntval*1000);
		this.attrTimers[attr] = timer;
	}.bind(this)).done();	
}

PollingDevice.prototype.configReport = function(endpoint, cluster, attr, intval, callback) {
	var deferred = Q.defer();
	endpoint.foundation(cluster, 'configReport', [{ direction : 0, attrId: attr,
		dataType : zclId.attrType(cluster, attr).value,
		minRepIntval : intval, maxRepIntval : intval
	}]).then(function(rsp) {
		if(rsp.status == 0) {
			// TODO: set emit
			deferred.resolve();
		} else {
			// status = 140 UNREPORTABLE ATTRIBUTE
			log.error('Config report %s status %s', this.getType().key, rsp.status);
			deferred.reject(rsp);
		}
	}.bind(this)).fail(function(err) {
		log.error('Config report frame %s', fmtJson(err));
		deferred.reject(err);
	}).done();
	return deferred.promise.nodeify(callback);
}

PollingDevice.prototype.clearPolls = function() {
	_.each(this.attrTimers, function(timer) {
		clearInterval(timer);
	});
	this.attrTimers = {};
}

//other routines
function fmtJson(json) {
	return JSON.stringify(json, null, 2);
}

module.exports = PollingDevice;

