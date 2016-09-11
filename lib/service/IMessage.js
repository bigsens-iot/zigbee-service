/*
 * Copyright (c) 2016, Bigsens, LLC
 * ZigBee message API implementation
 * Author: Constantin Alexandrov
 */

'use strict';

var util = require('util'),
	debug = require('debug')('IMessage'),
	Stream = require('stream');


function IMessage() {}
util.inherits(IMessage, Stream);


/*
 * Messages
 */

IMessage.prototype.serviceAnnounce = function() {
	this.sendMessage('SERVICE_ANNCE', this.info());
}

IMessage.prototype.serviceReady = function() {
	this.sendMessage('SERVICE_READY', { guid : this.getGuid() });
}

IMessage.prototype.serviceInfo = function() {
	this.sendMessage('SERVICE_INFO', this.getNwkInfo());
}

IMessage.prototype.messageRegister = function(messages) {
	this.sendMessage('MESSAGE_REGISTER', messages);
}

IMessage.prototype.deviceState = function(state) {
	this.sendMessage('DEVICE_STATE', state);
}


/*
 * Async methods
 */

IMessage.prototype.on('message:PERMIT_JOIN', function(joinTime) {
	if(this.isReady && this.deviceManager) {
		this.deviceManager.permitJoin(joinTime).then(function() {
			this.sendMessage('PERMIT_JOIN', { status : 0 });
		}).fail(function(err) {
			this.sendMessage('PERMIT_JOIN', { error : err });
		});
	}
});

IMessage.prototype.on('message:DEVICE_READ_ATTRIBUTE', function(id, cls, attr) {
	var message = 'DEVICE_READ_ATTRIBUTE';
	if(this.isReady && this.deviceManager) {
		var device = this.deviceManager.getDeviceById(id);
		if(device) {
			var elist = device.innerDev.epList,
				ep = (elist.length == 1 ? elist[0] : null);
			if(ep) {
				device.readAttribute(ep, cls, attr).then(function() {
					this.sendMessage(message, { device : this });
				}).fail(function(err) {
					this.sendMessage(message, { error : err });
				}).done();
			} else {
				this.sendMessage(message, { error : 'Attribute not found' });
			}
		} else {
			this.sendMessage(message, { error : 'Device not found' });
		}
	}
});

/*
 * Sync methods
 */

IMessage.prototype.on('messages:MESSAGE_DISCOVER', function() {
	if(this.isReady && this.zap) {
		this.sendMessage('MESSAGE_DISCOVER', this.register);
	}
});

IMessage.prototype.on('message:SERVICE_INFO', function() {
	if(this.isReady && this.zap) {
		this.sendMessage('SERVICE_INFO', this.getNwkInfo());
	}
});

IMessage.prototype.on('message:DEVICE_LIST', function() {
	debug('device list');
	if(this.isReady && this.deviceManager) {
		var deviceList = this.deviceManager.deviceList();
		this.sendMessage('DEVICE_LIST', deviceList);
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


module.exports = IMessage;

