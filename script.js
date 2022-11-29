const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const log = require('fs');

const { WebcastPushConnection } = require('tiktok-livestream-chat-connector');

const TIKTOK_USERNAME = "TIKTOK_USERNAME";

let getYYYYMMDDHHMMSS = function() {
	return (new Date()).toISOString().split('T')[0];
};

let log_date = new Date();
const date_offset = log_date.getTimezoneOffset();
log_date = new Date(log_date.getTime() - (date_offset * 60 * 1000));
const LOG_FILENAME = "logs/log-"+ TIKTOK_USERNAME +"-"+ log_date.getFullYear() + log_date.getMonth() + log_date.getDay() +".log";

let logActivity = function(activity_str) {
	log.appendFile(LOG_FILENAME, activity_str +"\n", err => {
		if(err) {
			console.error(err);
		}
	});
}

logActivity("Starting log for stream of '"+ TIKTOK_USERNAME +"'...");

// stream stats
let stream_activity = {
	'viewer_count': 0,
	'like_count': 0
};

// keep track of highest like counts. key = username, value = like count
let stream_likers = {};

// keep track of messages sent. key = username, value = number of messages
let stream_chatters = {};

// Web server
app.get('/', (req, res) => {
	res.sendFile(__dirname +"/index.html");
});

server.listen(3000, () => {
	console.log('listening on *:3000');
});

// Chat server
io.on('connection', (socket) => {
	console.log('IO: a user connected');
	
	socket.on('disconnect', () => {
		console.log('user disconnected');
	});
});

function sendBlip(type, cargo) {
	io.emit('blip', {
		'type': type,
		'cargo': cargo
	});
	
	// This will emit the event to all connected sockets
}

// Create a new wrapper object and pass the username
let tiktokChatConnection = new WebcastPushConnection(TIKTOK_USERNAME);

// Connect to the chat (await can be used as well)
tiktokChatConnection.connect().then(state => {
	console.info(`Connected to roomId ${state.roomId}`);
}).catch(err => {
	console.error('Failed to connect', err);
});

// Define the events that you want to handle
// In this case we listen to chat messages (comments)
tiktokChatConnection.on('chat', data => {
	console.log(`${data.uniqueId}: ${data.comment}`);
	
	if(!(data.uniqueId in stream_chatters)) {
		stream_chatters[ data.uniqueId ] = {
			'avatar': data.profilePictureUrl,
			'count': 0
		};
	}
	
	stream_chatters[ data.uniqueId ].count++;
	
	sendBlip("chat", {
		'username': data.uniqueId,
		'comment': data.comment,
		'data': data
	});
	
	logActivity("[chat] "+ data.uniqueId +": "+ data.comment);
});

// And here we receive gifts sent to the streamer
tiktokChatConnection.on('gift', data => {
	//console.log(`${data.uniqueId} (userId:${data.userId}) sends ${data.giftId}`);
	console.log(`GIFT: ${data.giftId} from ${data.uniqueId}`);
	console.log(data);
	
	sendBlip("gift", {
		'username': data.uniqueId,
		'gift': data.giftId,
		'data': data
	});
	
	logActivity("[gift] "+ data.label.replace("{0:user}", data.uniqueId) +" (giftId: "+ data.giftId +")");
});

function util__keysWithHighestValue(o, n, o_key) {
	let keys = Object.keys(o);
	keys.sort(function(a, b) {
		return o[b][o_key] - o[a][o_key];
	});
	
	return keys.slice(0, n);
}

function fn__generate_top_chatters() {
	let top_chatters = [];
	let top_chatters_raw = util__keysWithHighestValue(stream_chatters, 10, 'count');
	
	for(let i = 0; i < top_chatters_raw.length; i++) {
		top_chatters.push({
			'username': top_chatters_raw[ i ],
			'avatar': stream_chatters[ top_chatters_raw[ i ] ].avatar,
			'count': stream_chatters[ top_chatters_raw[ i ] ].count
		});
	}
	
	return top_chatters;
}

// view count/top chatters update
tiktokChatConnection.on('roomUser', data => {
	sendBlip("viewer_count_update", {
		'viewer_count': data.viewerCount,
		'data': data
	});
	
	sendBlip("top_chatters_update", {
		'list': fn__generate_top_chatters()
	});
});

// stream liked by user
tiktokChatConnection.on('like', data => {
	console.log(`${data.uniqueId} sent ${data.likeCount} likes, total likes: ${data.totalLikeCount}`);
	
	if(!(data.uniqueId in stream_likers)) {
		stream_likers[ data.uniqueId ] = 0;
	}
	
	stream_likers[ data.uniqueId ] += data.likeCount;
	
	sendBlip("user_liked_stream", {
		'username': data.uniqueId,
		'likeCount': data.likeCount,
		'totalLikeCount': data.totalLikeCount,
		'data': data
	});
	
	logActivity("[stream_like] "+ data.uniqueId +": "+ data.totalLikeCount +" ("+ data.likeCount +" new)");
});

// someone shares the stream or follows host
tiktokChatConnection.on('social', data => {
	console.log('social event data:', data);
	sendBlip("social_event", {
		'data': data
	});
	
	logActivity("[social_event] "+ data.label.replace("{0:user}", data.uniqueId));
});