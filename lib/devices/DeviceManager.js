

function DeviceManager(zap) {
	
	this.zap = zap;
	
	this.zigbeeDevices = {};

}

DeviceManager.prototype.deviceType = function(dev) {	
	var epList = dev.epList,
		devType;

	// smart plug, water leak, entry sensor, etc.
	if (epList.length === 1 && _.includes(epList, 1)) {
		var ep = dev.getEndpoint(1);
        if (ep.getDevId() === 81) // Smart socket
            devType = DeviceType.DT_SMART_PLUG;

        if (ep.getDevId() === 1026) { // IAZ zone device
        	devType = DeviceType.DT_IAS_ZONE;
        	var attrs = this.findAttrsByClusterName(dev, 'ssIasZone');
        	if(attrs && attrs.zoneType) {
        		var zoneType = attrs.zoneType;
        		if(zoneType == 13)
        			devType = DeviceType.DT_MOTION_SENSOR;
        		if(zoneType == 21) {
        			devType = DeviceType.DT_CONTACT_SWITCH;
        			
        			if(!zigbeeDevices[dev.ieeeAddr]) {
        				var specDev = new ContactSwitchSensor(dev);
        				zigbeeDevices[dev.ieeeAddr] = specDev;
        			}

        		}
        		if(zoneType == 40)
        			devType = DeviceType.DT_FIRE_SENSOR;
        		if(zoneType == 42)
        			devType = DeviceType.DT_WATER_SENSOR;
        	}
        }
    }

	return { key : DeviceType.inverted[devType], value : devType };
}

function SmartPlugActuator(dev) {
	this.dev = dev;
	this.ep = dev.getEndpoint(1);
	this.type = DeviceType.DT_SMART_PLUG;
}

SmartPlugActuator.prototype.OnOff = function(value) {
	
}

function ContactSwitchSensor(dev) {
	this.dev = dev;
	this.ep = dev.getEndpoint(1);
	this.type = DeviceType.DT_CONTACT_SWITCH;

	setInterval(this.getValue.bind(this), 2000);
}

ContactSwitchSensor.prototype.getValue = function() {
	if(this.dev.status == 'online') {
		this.ep.foundation('ssIasZone', 'read', [ { attrId: 0x0002 } ], function (err, rsp) {
			if(!err) {
				if(rsp.length === 1) {
					var data = rsp[0].attrData;
					if(data == 33) console.log('Contact sensor is OPEN');
					if(data == 32) console.log('Contact sensor is CLOSE');
				}
			}
		});
	}
}
