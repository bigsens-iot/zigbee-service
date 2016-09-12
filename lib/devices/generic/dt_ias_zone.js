/*
 * Copyright (c) 2016, Bigsens, LLC
 * IAS Zone device
 * Author: Constantin Alexandrov
 */

'use strict';

var _ = require('underscore'),
	log4js = global.log4js,
	log = log4js.getLogger('IASZoneDevice'),
	debug = require('debug')('IASZoneDevice'),
	util = require('util'),
	Q = require('q'),
	Concentrate = require('concentrate'),
	DeviceType = require('../../protocol').DeviceType,
	AbstractDevice = require('../AbstractDevice');


var ZONE_STATE = {
    'NotEnrolled' : 0x00,
    // The client will react to Zone State Change Notification
    //commands from the server
    'Enrolled' : 0x01
    // Reserved : 0x02-0xff
};

var ZONE_STATUS_BITS = [
    'Alarm1', 'Alarm2', 'Tamper', 'Battery', 
    'SupervisionReports', 'RestoreReports', 'Trouble', 'AC',
    'Reserved1', 'Reserved2', 'Reserved3', 'Reserved4',
    'Reserved5', 'Reserved6', 'Reserved7', 'Reserved8'
];

function IASZoneDevice(dev) {
	IASZoneDevice.super_.apply(this, arguments);
	this.zoneState = ZONE_STATE.NotEnrolled;
	this.zoneStatus = null; // bitmap8
	this.zoneStatusEvent = 'ZCL:incomingMsg:'+dev.getNwkAddr()+':1:0';
	this.attributes = _.extend(_.reduce(ZONE_STATUS_BITS,function(attrs,key){
		attrs[key]=undefined;return attrs;},this.attributes),this.attributes);
}

util.inherits(IASZoneDevice, AbstractDevice);

IASZoneDevice.prototype.zoneStatusNotification = function(msg) {
	var payload = msg.zclMsg.payload;
	this.zoneState = ZONE_STATE.Enrolled;
	if(payload && payload.zonestatus) {
		var status = payload.zonestatus;
		this.endpoint.getClusters().set('ssIasZone', 'attrs', 'zoneStatus', status);
		this.zoneStatus = status;
		status = this.parseStatus(status);
		this.attributes = _.extend(this.attributes, status);
		this.emit('zoneStatusNotification', { ieeeAddr: this.dev.getIeeeAddr(), data : { zoneStatus : status } });
	}
}

IASZoneDevice.prototype.enroll = function(endpoint, zoneId, callback) {
	var deferred = Q.defer();
	this.invokeMethod(endpoint, 'ssIasZone', 'enrollRsp', [{
		enrollrspcode: 0x00, zoneid: zoneId
	}]).then(function(rsp) {
		if(rsp.statusCode == 0) {
			this.zoneState = ZONE_STATE.Enrolled;
			deferred.resolve();
		} else { deferred.reject(rsp); }
	}.bind(this)).fail(function(err) {deferred.reject(err)}).done();
	return deferred.promise.nodeify(callback);
}

IASZoneDevice.prototype.parseStatus = function(zoneStatus) {
	var status = {};
	Concentrate().uint16le(zoneStatus).result().readUInt16LE(0).toString(2)
		.split('').reverse().forEach(function(bit, pos) {
			status[ZONE_STATUS_BITS[pos]] = (bit === '1');
		});
	return status;
}

module.exports = IASZoneDevice;

