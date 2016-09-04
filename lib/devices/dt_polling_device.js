/*
 * Copyright (c) 2016, Bigsens, LLC
 * Polling device
 * Author: Constantin Alexandrov
 */

'use strict';

var _ = require('underscore'),
	log4js = global.log4js,
	log = log4js.getLogger('PollingDevice'),
	debug = require('debug')('PollingDevice'),
	util = require('util'),
	DeviceType = require('../service/protocol').DeviceType,
	Driver = require('./Driver');


function PollingDevice(dev) {
	PollingDevice.super_.apply(this, arguments);
	this.timerId = [];
	this.on('readAttribute', function(device, cluster, attr, value) {
		this.emit('reportAttribute', device, cluster, attr, value);
	}.bind(this));
}

util.inherits(PollingDevice, Driver);

PollingDevice.prototype.reportAttribute = function(endpoint, cluster, attr, interval) {
	var tid = setInterval(this.readAttribute.bind(this, endpoint, cluster, attr), interval || 10000);
	this.timerId.push(tid);
}

PollingDevice.prototype.clearPolls = function() {
	_.forEach(this.timerId, function(id) {
		clearInterval(id);
	});
}

module.exports = PollingDevice;

