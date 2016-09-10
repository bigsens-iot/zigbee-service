/*
 * Copyright (c) 2016, Bigsens, LLC
 * IAS Zone device
 * Author: Constantin Alexandrov
 */

'use strict';

var log4js = global.log4js,
	log = log4js.getLogger('IASZoneDevice'),
	debug = require('debug')('IASZoneDevice'),
	util = require('util'),
	Q = require('q'),
	Concentrate = require('concentrate'),
	DeviceType = require('../../service/protocol').DeviceType,
	AbstractDevice = require('../AbstractDevice');


var ZONE_STATUS = {
    'NotEnrolled' : 0x00,
    // The client will react to Zone State Change Notification
    //commands from the server
    'Enrolled' : 0x01
    // Reserved : 0x02-0xff
};

var ZONE_STATE_BITS = [
    'Alarm1', 'Alarm2', 'Tamper', 'Battery', 
    'SupervisionReports', 'RestoreReports', 'Trouble', 'AC',
    'Reserved1', 'Reserved2', 'Reserved3', 'Reserved4',
    'Reserved5', 'Reserved6', 'Reserved7', 'Reserved8'
];

function IASZoneDevice(dev) {
	IASZoneDevice.super_.apply(this, arguments);
	this.attributes.zoneStatus = null;
	this.attributes.zoneState = null;
}

util.inherits(IASZoneDevice, AbstractDevice);

IASZoneDevice.prototype.zoneStatusNotification = function(msg) {
	var payload = msg.zclMsg.payload;
	if(payload && payload.zonestatus) {
		this.endpoint.getClusters().set('ssIasZone', 'attrs', 'zoneStatus', payload.zonestatus);
		var state = this.parseState(payload.zonestatus);
		this.emit('zoneStatusNotification', { ieeeAddr: this.dev.getIeeeAddr(), data : { zoneStatus : state } });
	}
}

IASZoneDevice.prototype.enroll = function(endpoint, zoneId, callback) {
	var deferred = Q.defer();
	this.invokeMethod(endpoint, 'ssIasZone', 'enrollRsp', [{
		enrollrspcode: 0x00, zoneid: zoneId
	}]).then(function(dev, cluster, attr, value){
		this.zoneStatus = value;
		deferred.resolve(value);
	}.bind(this)).fail(function(err) {deferred.reject(err)}).done();
	return deferred.promise.nodeify(callback);
}

IASZoneDevice.prototype.parseState = function(zoneState) {
	var state = {};
	Concentrate().uint16le(zoneState).result().readUInt16LE(0).toString(2)
		.split('').reverse().forEach(function(bit, pos) {
			state[ZONE_STATE_BITS[pos]] = (bit === '1');
		});
	this.zoneState = state;
	return state;
}

module.exports = IASZoneDevice;

