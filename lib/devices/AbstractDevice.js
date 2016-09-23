/*
 * Copyright (c) 2016, Bigsens, LLC
 * AbstractDevice is the parent class for all ZigBee devices
 * Author: Constantin Alexandrov
 */

'use strict';

var _ = require('underscore'),
	Q = require('q'),
	log4js = global.log4js,
	log = log4js.getLogger('AbstractDevice'),
	debug = require('debug')('AbstractDevice'),
	util = require('util'),
	EventEmitter = require('events').EventEmitter,
	Concentrate = require('concentrate'),
	DeviceType = require('../protocol').DeviceType,
	aguid = require('aguid'),
	zclId = require('zcl-id');


function Mapper() {
	this._mapped = {};
}

Mapper.prototype.link = function(dstattr, srcattr, mutator) {
	if(_.isFunction(mutator)) {
		this._mapped[srcattr] = {
			dstattr : dstattr,
			mutator : mutator
		}
	} else {
		this._mapped[srcattr] = dstattr;
	}
}

Mapper.prototype.process = function(src) {
	var self = this,
		ret = {};
	_.each(src, function(attrs, clsname) {
		if(_.isObject(attrs)) {
			_.each(attrs.attrs, function(value, attrname) {
				var map = self._mapped[clsname+'.'+attrname];
				if(map) {
					if(_.isObject(map) && _.isFunction(map.mutator)) {
						var v = map.mutator(value);
						if(map.dstattr == null && _.isObject(v)) {
							ret = _.extend(ret, v);
						} else {
							ret[map.dstattr] = v;
						}
					} else if(_.isString(map)) {
						ret[map] = value;
					}
				}
			});
		}
	});
	return ret;
}

function AbstractDevice(dev)  {
	this._mapper = new Mapper();
	this.dev = dev;
	this.guid = dev.ieeeAddr ? aguid(dev.ieeeAddr) : aguid();
	this.type;
	this.attributes = {};
	this.methods = {};
}

util.inherits(AbstractDevice, EventEmitter);

AbstractDevice.prototype.info = function() {
	return {
		guid : this.guid, // device unique id
		type : this.type, // device type, see protocol.js -> DeviceTypes
		status : this.dev ? this.dev.status : 'unknown', // unknown, offline, online
		attributes : this.attributes, // attributes names and values
		methods : this.methods // supported methods
	};
}

AbstractDevice.prototype.extendedInfo = function() {
	// Protocol depended information about device
	return _.extend(this.info(), {spec:this.dev.dump()});
}

AbstractDevice.prototype.getDev = function() {
	return this.dev;
}

AbstractDevice.prototype.getGuid = function() {
	return this.guid;
}

AbstractDevice.prototype.getType = function() {
	return { key : DeviceType.inverted[this.type], value : this.type };
}

AbstractDevice.prototype._setAttr = function(cluster, attr, value) {
	if(_.isNumber(attr)) {
		attr = zclId.attr(cluster, attr);
	}
	this.attributes[attr.key || attr] = value;
	// need cluster.attr
}

AbstractDevice.prototype.isIas = function() {
	return _.has(this, 'zoneState');
}

AbstractDevice.prototype.attr = function(dstattr, srcattr, mutator) {
	var ca = srcattr.split('.'),
		clsname = ca[0], attrname = ca[1],
		attrs, attrvalue = null,
		endpoints = this.dev.endpoints;
	if(endpoints) {
		_.each(endpoints, function(ep) {
			var ziee = ep.clusters;
			if(ziee && ziee.has(clsname)) {
				attrvalue = ziee.get(clsname, 'attrs', attrname);
			}
		});
		if(_.isFunction(mutator) && attrvalue) {
			attrvalue = mutator(attrvalue);
		}
	}
	if(dstattr == null &&_.isObject(attrvalue)) {
		this.attributes = _.extend(this.attributes, attrvalue)
	} else {
		this.attributes[dstattr] = attrvalue;
	}
	this._mapper.link(dstattr, srcattr, mutator);
}

AbstractDevice.prototype.update = function(data) {
	var devinfo = this.info(),
		attrs = this._mapper.process(data);
	this.attributes = _.extend(this.attributes, attrs);
	devinfo.attributes = attrs;
	return devinfo;
}

AbstractDevice.prototype.readAttribute = function(endpoint, cluster, attr, callback) {
	var deferred = Q.defer();
	if(this.dev && this.dev.status == 'online') {
		endpoint.foundation(cluster, 'read', [ { attrId: attr } ])
			.then(function(rsp) {
				if(rsp && rsp.length === 1) {
					var value = rsp[0].attrData;
					//this._setAttr(cluster, attr, value);
					this.emit('readAttribute', this, cluster, attr, value);
					deferred.resolve(this.dev, cluster, attr, value);
				}
			}.bind(this)).fail(function(err) {
				console.log(err);
				log.error('Device %s read attribute %s error %s', this.getType().key, attr, err);
				deferred.reject(err);
			}.bind(this)).done();
	} else {
		deferred.reject();
	}
	return deferred.promise.nodeify(callback);
}

AbstractDevice.prototype.writeAttribute = function(endpoint, cluster, attr, value, callback) {
	var deferred = Q.defer();
	if(this.dev && this.dev.status == 'online') {
		endpoint.foundation(cluster, 'write', [{ attrId : attr,
			dataType : zclId.attrType(cluster, attr).value, attrData : value }]).then(function(rsp) {
				if(rsp) {
					//this._setAttr(cluster, attr, value);
					this.emit('writeAttribute', this, cluster, attr, value);
					deferred.resolve(this.dev, cluster, attr, value);
				}
			}.bind(this)).fail(function(err) {
				console.log(err);
				log.error('Device %s write attribute %s error %s', this.getType().key, attr, err);
				deferred.reject(err);
			}.bind(this)).done();
	} else {
		deferred.reject();
	}
	return deferred.promise.nodeify(callback);
}

AbstractDevice.prototype.invokeMethod = function(endpoint, cluster, cmd, params, callback) {
	var deferred = Q.defer(),
		params = params || {};
	if(this.dev && this.dev.status == 'online') {
		endpoint.functional(cluster, cmd, params).then(function(rsp){deferred.resolve(rsp);})
		.fail(function(err) {
			log.error('Device %s invoke method %s error %s', this.getType().key, cmd, err);
			deferred.reject(err);
		}.bind(this)).done();
	}
	return deferred.promise.nodeify(callback);
}

AbstractDevice.prototype.indentify = function(endpoint, time) {
	return this.writeAttribute(endpoint, 'genIdentify', 'identifyTime', time);
}

AbstractDevice.prototype.cleanup = function() {
	this.removeAllListeners('reportAttribute');
	if(this.zclIncoming) {
		this.removeAllListeners('zclIncoming', this._zclHandle);
	}
	if(this.clearPolls) {
		this.clearPolls();
	}
}

//other routines
function fmtJson(json) {
	return JSON.stringify(json, null, 2);
}

module.exports = AbstractDevice;

