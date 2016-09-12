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
	IASZoneDevice = require('../generic/dt_ias_zone');


function AncillaryControl(dev) {
	AncillaryControl.super_.apply(this, arguments);
	this.type = DeviceType.DT_IAS_ANCILLARY_CONTROL_EQUIPMENT;
	this.ep = this.dev.getEndpoint(1);

	this.on('reportAttribute', function(device, cluster, attr, value) {
		console.log('Ancillary control battery voltage is', value);
	}.bind(this));

	//this.reportAttribute(this.ep, 'genPowerCfg', 'batteryVoltage', 10000);
}

util.inherits(AncillaryControl, IASZoneDevice);

module.exports = AncillaryControl;

