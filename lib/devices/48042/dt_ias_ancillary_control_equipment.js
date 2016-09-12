/*
 * Copyright (c) 2016, Bigsens, LLC
 * Ancillary control equipment device
 * Author: Constantin Alexandrov
 */

'use strict';

var log4js = global.log4js,
	log = log4js.getLogger('AncillaryControl'),
	debug = require('debug')('AncillaryControl'),
	util = require('util'),
	DeviceType = require('../../protocol').DeviceType,
	PollingDevice = require('../generic/dt_polling_device');


var ARM_MODE = {
	'Disarm' : 0x00,
	'Arm Day/Home Zones Only' : 0x01,
	'Arm Night/Sleep Zones Only' : 0x02,
	'Arm All Zones' : 0x03
};

function AncillaryControl(dev) {
	AncillaryControl.super_.apply(this, arguments);
	this.type = DeviceType.DT_IAS_ANCILLARY_CONTROL_EQUIPMENT;
	this.zclIncoming = 'ZCL:incomingMsg:'+dev.getNwkAddr()+':1:0';
	this.endpoint = this.dev.getEndpoint(1);

	this.on('reportAttribute', function(device, cluster, attr, value) {
		console.log('Ancillary control battery voltage is', value);
	}.bind(this));

	//this.reportAttribute(this.ep, 'genPowerCfg', 'batteryVoltage', 10000);
}

util.inherits(AncillaryControl, PollingDevice);

AncillaryControl.prototype._zclHandle = function(msg) {
	var data, cmd = msg.zclMsg ? msg.zclMsg.cmdId : undefined;
	this.dev.status = 'online';
	if(cmd == 'arm') {
		var payload = msg.zclMsg.payload,
			armmode = payload.armmode;
		this.indentify(this.endpoint, 3);
		data = {}; data[cmd] = { mode : armmode };
	} else if(cmd == 'emergency') {
		this.indentify(this.endpoint, 5);
		data = {}; data[cmd] = {};
	}
	if(cmd && data) {
		debug('cmd %s data %j', cmd, data);
		this.emit('_zclHandle', { ieeeAddr: this.dev.getIeeeAddr(), data : data });
	}
}

module.exports = AncillaryControl;

