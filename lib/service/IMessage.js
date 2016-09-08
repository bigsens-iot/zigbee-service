/*
 * Copyright (c) 2016, Bigsens, LLC
 * ZigBee message API implementation
 * Author: Constantin Alexandrov
 */

'use strict';

var util = require('util'),
	Stream = require('stream');


function IMessage() {}
util.inherits(IMessage, Stream);


IMessage.prototype.serviceAnnounce = function(args) {
	this.sendMessage('SERVICE_ANNCE', args);
}

IMessage.prototype.on('message:DEVICE_LIST', function() {
	debug('device list');
	if(this.isReady && this.deviceManager) {
		var deviceList = this.deviceManager.deviceList();
		this.sendMessage('DEVICE_LIST', deviceList);
	}
});

IMessage.prototype.on('message:PERMIT_JOIN', function(joinTime) {
	if(this.isReady && this.deviceManager) {
		this.deviceManager.permitJoin(joinTime);
	}
});

IMessage.prototype.on('message:DEVICE_GET_INFO_BY_ID', function(id) {
	if(this.isReady && this.deviceManager) {
		var deviceInfo = this.deviceManager.deviceInfoById(id);
		this.sendMessage('DEVICE_GET_INFO_BY_ID', deviceInfo);
	}
});

IMessage.prototype.on('message:DEVICE_GET_EXTENDED_INFO_BY_ID', function(id) {
	if(this.isReady && this.deviceManager) {
		var deviceInfo = this.deviceManager.deviceExtendedInfoById(id);
		this.sendMessage('DEVICE_GET_EXTENDED_INFO_BY_ID', deviceInfo);
	}
});

IMessage.prototype.deviceState = function(state) {
	this.sendMessage('DEVICE_STATE', state);
}


module.exports = IMessage;

