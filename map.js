/*** 
More info about geojson data in google maps: 
https://developers.google.com/maps/documentation/javascript/datalayer 
***/

/** Initilaize variables **/

const google_api_key = 'AIzaSyCMETxi9mRjWMt726OBZAAhRyXj1xyuPOs';

const url = new URL(window.location.href);

const segments = {}, infowindows = {}, input_files = [];

let color_index = 1, line_index = 0, default_stroke_weight = 4, selected_stroke_weight = 8;

// These are defined later
let small_size, big_size, locations, oms, map, center, zoom_level;

// Check if there are input files
if (url.searchParams.get("input_files")) {
	url.searchParams.get("input_files").split("|").forEach(function(input_file){
		if (input_file) {
			input_files.push(input_file);
		}
	});
}

if (!input_files.length) {
	$("#legend ul li").text("No data provided!");
	$("#legend").css("color", "#f55");
	$("#legend").css("font-size", "1.5rem");
}

/** Define some functions **/
const _toRadian = function (degree) {
  return degree * Math.PI / 180;
};


// Takes as argument a list of points and an optional precision, returns the total distance (in km) 
function getDistance(array, decimals) {
  decimals = decimals || 3;
  const earthRadius = 6378.137; // km
  
  let distance = 0,
    len = array.length,
    i,
    x1,
    x2,
    lat1,
    lat2,
    lon1,
    lon2,
    dLat,
    dLon,
    a,
    c,
    d;
  for (i = 0; (i + 1) < len; i++) {
    x1 = array[i];
    x2 = array[i + 1];

    lat1 = parseFloat(x1[0]);
    lat2 = parseFloat(x2[0]);
    lon1 = parseFloat(x1[1]);
    lon2 = parseFloat(x2[1]);

    dLat = _toRadian(lat2 - lat1);
    dLon = _toRadian(lon2 - lon1);
    lat1 = _toRadian(lat1);
    lat2 = _toRadian(lat2);

    a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
    c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    d = earthRadius * c;
    distance += d;
  }
  distance = Math.round(distance * Math.pow(10, decimals)) / Math.pow(10, decimals);
  return distance;
}

// Extends the boundary of the map based on the geometry passed
function extendBounds(geometry, callback, thisArg) {
	if (geometry instanceof google.maps.LatLng) {
		callback.call(thisArg, geometry);
	} else if (geometry instanceof google.maps.Data.Point) {
		callback.call(thisArg, geometry.get());
	} else {
		geometry.getArray().forEach(function(g) {
			extendBounds(g, callback, thisArg);
		});
	}
}

// Loads a json file using XMLHttpRequest
function loadJSON(file, callback) {
	let xobj = new XMLHttpRequest();
	xobj.overrideMimeType("application/json");
	xobj.open('GET', file, true);
	xobj.onreadystatechange = function() {
		if (xobj.readyState === 4 && xobj.status === 200) {
		  callback(xobj.responseText);
		}
	}
	xobj.send();
}

// Define a new line
function startNewLine() {
	color_index++;
	current_color = makeColorGradient(2.4,2.4,2.4,0,2,4,color_index);
	return {
		"type": "Feature",
		"properties": {
			"strokeColor": current_color,
			"index": line_index++,
			"strokeWeight": default_stroke_weight,
			"zIndex": 0
		},
		"geometry":{
			"type": "LineString",
			"coordinates": []
		}
	}
}

// This function was taken from here: https://krazydad.com/tutorials/makecolors.php
// Basically just a way to create a random color
function makeColorGradient(frequency1, frequency2, frequency3,
                             phase1, phase2, phase3, i) {
  const center = 128,
  	width = 127,
  	red = Math.sin(frequency1 * i + phase1) * width + center,
  	grn = Math.sin(frequency2 * i + phase2) * width + center,
  	blu = Math.sin(frequency3 * i + phase3) * width + center;
  return RGB2Color(red,grn,blu);
}

function RGB2Color(r,g,b) {
  return 'rgb(' + Math.round(r) + ',' + Math.round(g) + ',' + Math.round(b) + ')';
}

// Finds a locality name in the response passed
function getLocality(string) {
	response = JSON.parse(string);
	let locality = "";
	search_for = ["locality", "administrative_area_level_3", "administrative_area_level_2"];
	if (response.results && response.results[0]) {
		for (let index_address in response.results[0].address_components) {
			if(response.results[0].address_components[index_address].types.some(function (v) { return search_for.indexOf(v) >= 0;
		    })) {
				locality = response.results[0].address_components[index_address].short_name;
				break;
			}
		}
	}
	return locality;
}

// Adds a marker on the map
// To deal with overlapping markers, I used: https://github.com/jawj/OverlappingMarkerSpiderfier
function addMarker(map, location, index, point) {
	let marker_index = (index + 1) * 2;
	if (point == 'start') {
		marker_index -= 1;
	}
	
	const image = {
	  url: 'https://raw.githubusercontent.com/Concept211/Google-Maps-Markers/master/images/marker_orange.png',
	  labelOrigin: new google.maps.Point(15, 40),
	  size: small_size,
	  scaledSize: small_size,
	  zIndex: point == 'start' ? 500 - marker_index : 1
	};

	const marker = new google.maps.Marker({
      position: location,
      icon: image,
	  zIndex: point == 'start' ? 500 - marker_index : 1
    });
    
    oms.addMarker(marker);
    marker.addListener('spider_click', function(event) {
	    handleEvent(null, index);
	});
    
    segments[index]["markers"] = segments[index]["markers"] || {};
    segments[index]["markers"][point] = marker;
}

// Generates a segment
function updateSegment(feature, coordinates, line, point) {
	let mark_lat = coordinates[1],
		mark_lng = coordinates[0],
		index = line.properties.index,
		locality_mark,
		input = mark_lat + ',' + mark_lng;
	
	// Waterfall of potentially time consuming operations
	async.waterfall([
	    // Search in the locations object
	    function (callback) {
	        if (locations[input]) {
				locality_mark = locations[input];
			}
			callback(null, locality_mark);
	    },
	    // If found, skip this, otherwise make a google maps call
	    function (locality_mark, callback) {
	        if (locality_mark) {
	        	callback(null, locality_mark);
	        }
	        else {
	        	loadJSON("https://maps.googleapis.com/maps/api/geocode/json?latlng=" + input + "&key=" + google_api_key, function(response) {
					locality_mark = getLocality(response);
					callback(null, locality_mark);
				});
	        }
	    }
	], function (err, locality_mark) {
	    feature.properties.start = locality_mark;
		segments[index] = segments[index] || {}
		segments[index][point] = locality_mark;
		segments[index]["distance"] = segments[index]["distance"] || getDistance(line.geometry.coordinates, 2);
		const distance = segments[index]["distance"];
		// If the point we are dealing with is the start of the segment, just store the start time.
		// If it's the end, decide where to put the infowindow.
		if (point == "start") {
			if (feature.properties.coordTimes) {
				segments[index]["start_time"] = feature.properties.coordTimes[0];
			}
			else {
				segments[index]["start_time"] = feature.properties.time;
			}
		}
		if (point == "end") {
			if (feature.properties.coordTimes) {
				segments[index]["end_time"] = feature.properties.coordTimes[feature.properties.coordTimes.length - 1];
			}
			else {
				segments[index]["end_time"] = feature.properties.time;
			}

			// I tried to come up with an algorithm to find a reasonable centre.
			// I start with half of the points and if the distance is close to one end or the other,
			// I increase or decrease the index of the points where I want it to appear.
			// This works fine if a segment has an unbalanced time 
			// (say faster at the beginning and slower at the end)
			// but it's still not perfect when I have an accumulation of points around the same location.
			let left_length = Math.ceil(line.geometry.coordinates.length / 2);
			let left_side = coordinates.slice(0, left_length);
			let left_distance = getDistance(left_side, 2);
			
			const step = 5;

			if (Math.abs(left_distance / distance - 0.5) > 0.1)
			{
				if (left_distance > distance / 2) {
					while(left_distance > distance / 2) {
						left_length -= step;
						left_side = line.geometry.coordinates.slice(0, left_length);
						left_distance = getDistance(left_side, 2);
					}
				}
				else {
					while(left_distance < distance / 2) {
						left_length += step;
						left_side = line.geometry.coordinates.slice(0, left_length);
						left_distance = getDistance(left_side, 2);
					}
				}
			}

			let midPoint = new google.maps.LatLng(
				parseFloat(line.geometry.coordinates[left_length][1]), 
				parseFloat(line.geometry.coordinates[left_length][0]));

			infowindows[index] = new google.maps.InfoWindow({
		  		position: midPoint
	  		});
	  		google.maps.event.addListener(infowindows[index], 'closeclick', function() {
		      resetMapView(true);
		    });
		}
		
		const latLng = new google.maps.LatLng(parseFloat(mark_lat), parseFloat(mark_lng));
		addMarker(map, latLng, index, point);
	});
}

// Adds a label
function setLabel(segment, point) {
	segment.markers[point].setLabel({
		text: segment[point],
	    fontSize: "14px",
	    fontWeight: "bold",
  		fontFamily: "Montserrat, Georgia, Times, serif",
  		color: "black"
	});
}

// Returns a string with the total time between 2 dates in hours and minutes
function getTimeDifference(date_start, date_end) {
	let delta = Math.abs(date_end - date_start) / 1000;
	const hours = Math.floor(delta / 3600) % 24;
	delta -= hours * 3600;
	const minutes = Math.floor(delta / 60) % 60;
	delta -= minutes * 60;
	const seconds = delta % 60;
	return (hours ? (hours + " hr and ") : '') + (minutes ? (minutes + " min") : '');
}

// Resets the map view
function resetMapView(noResetZoom) {
	if(!noResetZoom) {
		map.setZoom(zoom_level);
		map.setCenter(center);
	}
	resetLines();
	resetInfoWindows();
	resetMarkers();
}

// Resets the markers
function resetMarkers(index_feature) {
	let open_infowindow_index;
	for (let index_infowindow in infowindows) {
		let marker_index = (parseInt(index_infowindow) + 1) * 2;
		if(index_infowindow == index_feature) {			
			segments[index_infowindow].markers.start.setLabel({
				text: segments[index_infowindow].start,
			    fontSize: "14px",
			    fontWeight: "bold",
		  		fontFamily: "Montserrat, Georgia, Times, serif",
		  		color: "black"
			});
			let zIndex = 1000;
			let end_icon = segments[index_infowindow].markers.end.getIcon();
			end_icon.size = big_size;
			end_icon.scaledSize = big_size;
			end_icon.zIndex = zIndex;
			end_icon.url = 'https://raw.githubusercontent.com/Concept211/Google-Maps-Markers/master/images/marker_red.png';
			segments[index_infowindow].markers.end.setIcon(end_icon);
			segments[index_infowindow].markers.end.setZIndex(zIndex);
			
			let start_icon = segments[index_infowindow].markers.start.getIcon();
			start_icon.size = big_size;
			start_icon.scaledSize = big_size;
			start_icon.zIndex = zIndex;
			start_icon.url = 'https://raw.githubusercontent.com/Concept211/Google-Maps-Markers/master/images/marker_red.png';
			segments[index_infowindow].markers.start.setIcon(start_icon);
			segments[index_infowindow].markers.start.setZIndex(zIndex);

			segments[index_infowindow].markers.end.setLabel({
				text: segments[index_infowindow].end,
			    fontSize: "14px",
			    fontWeight: "bold",
		  		fontFamily: "Montserrat, Georgia, Times, serif",
		  		color: "black"
			});
		}
		else {
			segments[index_infowindow].markers.start.setLabel(null);
			segments[index_infowindow].markers.end.setLabel(null);

			let zIndex = 100 - marker_index;
			let end_icon = segments[index_infowindow].markers.end.getIcon();
			end_icon.size = small_size;
			end_icon.scaledSize = small_size;
			end_icon.zIndex = zIndex;
			end_icon.url = 'https://raw.githubusercontent.com/Concept211/Google-Maps-Markers/master/images/marker_orange.png';
			segments[index_infowindow].markers.end.setIcon(end_icon);
			segments[index_infowindow].markers.end.setZIndex(zIndex);
			
			zIndex = 500 - marker_index;
			let start_icon = segments[index_infowindow].markers.start.getIcon();
			start_icon.size = small_size;
			start_icon.scaledSize = small_size;
			start_icon.zIndex = zIndex;
			start_icon.url = 'https://raw.githubusercontent.com/Concept211/Google-Maps-Markers/master/images/marker_orange.png';
			segments[index_infowindow].markers.start.setIcon(start_icon);
			segments[index_infowindow].markers.start.setZIndex(zIndex);
		}
	}
	return open_infowindow_index;
}

// Resets the info window
function resetInfoWindows(index_feature) {
	let open_infowindow_index;
	for (let index_infowindow in infowindows) {
		let marker_index = (parseInt(index_infowindow) + 1) * 2;
		if(index_infowindow == index_feature) {
			infowindows[index_infowindow].setContent("" + 
				segments[index_feature].start + " --> " + segments[index_feature].end + 
				"<br>Distance: " + segments[index_feature].distance + " km" +
				"<br>Start: " + new Date(Date.parse(segments[index_feature].start_time)) +
				"<br>End: " + new Date(Date.parse(segments[index_feature].end_time)) + 
				"<br>Duration: " + getTimeDifference(Date.parse(segments[index_feature].start_time), Date.parse(segments[index_feature].end_time))
			);					
			open_infowindow_index = index_feature;
		}
		else {
			infowindows[index_infowindow].close(map);
		}
	}
	return open_infowindow_index;
}

// Resets the lines
function resetLines(feature_input) {
	map.data.forEach(function(feature) {
	    if (feature == feature_input) {
			feature.setProperty('strokeWeight', selected_stroke_weight);
			feature.setProperty('zIndex', 2);
		}
		else {
			feature.setProperty('strokeWeight', default_stroke_weight);
			feature.setProperty('zIndex', 0);
		}
	});
}

// Handles the click on either a line or marker 
function handleEvent(feature, index) {
	let index_feature;
	if (index !== undefined && index !== null) {
		index_feature = index;
		map.data.forEach(function(data_feature) {
			if (data_feature.getProperty("index") == index) {
				feature = data_feature;
			}
		});
	}
	else {
		index_feature = feature.getProperty("index");
	}
	resetLines(feature);
	resetMarkers(index_feature);
	
	let bounds = new google.maps.LatLngBounds();
	extendBounds(feature.getGeometry(), bounds.extend, bounds);
	map.fitBounds(bounds);
	open_infowindow_index = resetInfoWindows(index_feature);
	setTimeout(function() { infowindows[open_infowindow_index].open(map) }, 500);
}

function CenterControl(controlDiv, map) {

	// Set CSS for the control border.
	let controlUI = document.createElement('div');
	controlUI.style.backgroundColor = '#fff';
	controlUI.style.border = '2px solid #fff';
	controlUI.style.borderRadius = '3px';
	controlUI.style.boxShadow = '0 2px 6px rgba(0,0,0,.3)';
	controlUI.style.cursor = 'pointer';
	controlUI.style.marginBottom = '22px';
	controlUI.style.textAlign = 'center';
	controlUI.title = 'Click to recenter the map';
	controlDiv.appendChild(controlUI);

	// Set CSS for the control interior.
	let controlText = document.createElement('div');
	controlText.style.color = 'rgb(25,25,25)';
	controlText.style.fontFamily = 'Roboto,Arial,sans-serif';
	controlText.style.fontSize = '16px';
	controlText.style.lineHeight = '38px';
	controlText.style.paddingLeft = '5px';
	controlText.style.paddingRight = '5px';
	controlText.innerHTML = 'Reset Map';
	controlUI.appendChild(controlText);

	// Setup the click event listeners
	controlUI.addEventListener('click', function() {
	  resetMapView();
	});

}

// This is the function google maps calls when activated. 
function initMap() {
	
	const map_options = {
		disableDefaultUI: false
	};

	// Set default on somewhere around Toronto if there is no input data
	if (input_files.length == 0) {
		map_options.center = new google.maps.LatLng(45,-80);
		map_options.zoom = 7;
	}

	map = new google.maps.Map(document.getElementById('map'), map_options);

	small_size = new google.maps.Size(17, 30);
	big_size = new google.maps.Size(22, 40);

	// This zooms in or out the map to contain the added points 
	const bounds = new google.maps.LatLngBounds();
	map.data.addListener('addfeature', function(e) {
		extendBounds(e.feature.getGeometry(), bounds.extend, bounds);
		map.fitBounds(bounds);
	});

	// Set the style of the map
	map.data.setStyle(function(feature) {
	  const strokeColor = feature.getProperty('strokeColor');
	  return {
	    strokeColor: strokeColor,
	    strokeWeight: feature.getProperty('strokeWeight'),
	    zIndex: feature.getProperty('zIndex')
	  };
	});

	// Initialize the overlapping markers object
	oms = new OverlappingMarkerSpiderfier(map, {
	  markersWontMove: true,
	  markersWontHide: true,
	  basicFormatEvents: true,
	  keepSpiderfied: true
	});

	const timed_jsondata = {};
	const global_jsondata = {
		"type": "FeatureCollection",
		"features": []
	};

	// Create the DIV to hold the control and call the CenterControl()
    // constructor passing in this DIV.
    const centerControlDiv = document.createElement('div');
    const centerControl = new CenterControl(centerControlDiv, map);

    centerControlDiv.index = 1;
    map.controls[google.maps.ControlPosition.TOP_CENTER].push(centerControlDiv);

	// This is a nested sequence of async operations.
	// This could be changed to use promises but at the moment 
	// I don't know what the support for different browsers is.
	//
	// - Load a files of saved locations
	// -- Then for each input file, load the file and store the data in an object
	loadJSON("locations.json", function(locations_response) {
		locations = JSON.parse(locations_response);
		async.each(input_files, function(input_file, callback) {
			loadJSON(input_file + ".geojson", function(response) {
				const jsondata = JSON.parse(response);
				timed_jsondata[input_file] = [];
				for (let feature_index in jsondata.features)
				{
					timed_jsondata[input_file].push(jsondata.features[feature_index]);
				}
				callback();
			});
		}, function(err) {
			// Add each series of features to a global object accessible at different stages
		    Object.keys(timed_jsondata).sort().forEach(function(key, idx) {
		    	global_jsondata.features.push.apply(global_jsondata.features, timed_jsondata[key]);
			});
			let line = startNewLine();
			const features = [];
			const break_hours = 6;
			let time, old_time, time_difference, last_source;
			// Loops through all the features.
			// This loop handles 2 different structures:
			// a line in geojson could be defined as a LineString or 
			// as a collection of Point objects 
			// I break the segment in 2 if there is a break of 6 or more hours 
			// (if we are on a multiple file view)
			// or one hour or more in a single file view.
			for (let index in global_jsondata.features)
			{
				if(global_jsondata.features[index].geometry.type == "LineString") {
					if (last_source == 'Point') {
						features.push(line);
						updateSegment(global_jsondata.features[index - 1], global_jsondata.features[index - 1].geometry.coordinates, line, "end");
						line = startNewLine();
					}
					for (let coord_index = 0; coord_index < global_jsondata.features[index].properties.coordTimes.length; coord_index++) {
						time = new Date(global_jsondata.features[index].properties.coordTimes[coord_index]).getTime();
						time_difference = (time - old_time) / 1000;
						if (coord_index > 0 && (time_difference > 3600 * (input_files.length > 1 ? break_hours : 1) || time_difference < -3600)) {
							features.push(line);
							updateSegment(global_jsondata.features[index], global_jsondata.features[index].geometry.coordinates[coord_index - 1], line, "end");
							line = startNewLine();
							updateSegment(global_jsondata.features[index], global_jsondata.features[index].geometry.coordinates[coord_index], line, "start");
							last_source = global_jsondata.features[index].geometry.type;
						}
						line.geometry.coordinates.push(global_jsondata.features[index].geometry.coordinates[coord_index]);
						if (coord_index == 0 || coord_index == global_jsondata.features[index].geometry.coordinates.length - 1) {
							updateSegment(global_jsondata.features[index], global_jsondata.features[index].geometry.coordinates[coord_index], line, coord_index == 0 ? "start" : "end");
							last_source = global_jsondata.features[index].geometry.type;
						}
						old_time = time;
					}
					old_time = null;
				}
				else {
					time = new Date(global_jsondata.features[index].properties.time).getTime();
					time_difference = (time - old_time) / 1000;
					if (time_difference > 3600 * (input_files.length > 1 ? break_hours : 1) || time_difference < -3600) {
						features.push(line);
						updateSegment(global_jsondata.features[index - 1], global_jsondata.features[index - 1].geometry.coordinates, line, "end");
						line = startNewLine();
						updateSegment(global_jsondata.features[index], global_jsondata.features[index].geometry.coordinates, line, "start");
						last_source = global_jsondata.features[index].geometry.type;
					}
					line.geometry.coordinates.push(global_jsondata.features[index].geometry.coordinates);
					if (index == 0 || index == global_jsondata.features.length - 1) {
						updateSegment(global_jsondata.features[index], global_jsondata.features[index].geometry.coordinates, line, index == 0 ? "start" : "end");
						last_source = global_jsondata.features[index].geometry.type;
					}
					old_time = time;
				}
			}
			features.push(line);
			global_jsondata.features = features;
			if (input_files.length > 0) {
				
				map.data.addGeoJson(global_jsondata);
			}
			
			map.data.addListener('click', function(event) {	
			  if(event.feature.getGeometry().getType() == "LineString"){
				  handleEvent(event.feature);
				}
			});

			// Center the map when it's idle
			google.maps.event.addListenerOnce(map, 'idle', function(){
				zoom_level = map.getZoom();
				center = map.getCenter();
			});

			// When the event tilesLoaded is fired,
			// append a span element with the text.
			// This is used in another automation script to create thumbnails.
			google.maps.event.addListenerOnce(map, 'tilesloaded', function () { 
		    	if(segments.length) {
			    	const start = segments[0]['start'];
			    	const end = segments[Object.keys(segments).length - 1]['end'];
			    	const text = start + (start == end ? '' : (" to " + end));
			    	$("#container-fluid").append($("<span>", {id: "map-loaded", text: text})); 
			    }
		    });
		});
	});
}