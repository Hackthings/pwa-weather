const functions = require('firebase-functions');
const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');
const request = require('request');
const webpush = require('web-push');
const where = require('node-where');
const _ = require('lodash');

const app = express();

admin.initializeApp(functions.config().firebase);

app.use(cors());
app.enable('trust proxy');

const darkSkyApiKey = functions.config().env.dark_sky_key;
const GCMApiKey = functions.config().env.gcm_key;

const subscription = admin.firestore().collection('subscription');

const defaultsValues = {
	time: 8,
	timezone: 0,
	location: {
		latitude: 52.379473,
		longitude: 5.215532
	}
};

const errorMessage = (err, res) => {
	res.status(400).send(err.message);
};

app.get('/weather', (req, res) => {
	const lat = req.query.latitude || defaultsValues.location.latitude;
	const lng = req.query.longitude || defaultsValues.location.longitude;
	requestWeather(lat, lng)
		.then(response => {
			res.json(response);
		})
		.catch(err => errorMessage(err, res));
});

app.use('/geolocation', (req, res) => {
	//where.is('173.194.33.104', (err, result) => {
	where.is(req.ip, (err, result) => {
		res.send({
			latitude: result.attributes.lat,
			longitude: result.attributes.lng
		});
	});
});

// SUBSCRIBE FOR PUSH NOTIFICATIONS
app.post('/push/subscribe', (req, res) => {
	const timezone = req.body.timezone || defaultsValues.timezone;
	const time = req.body.time || defaultsValues.time;
	subscription
		.add({
			time,
			timezone,
			computed_time: time + timezone,
			subscription: req.body.subscription
		})
		.then(() => {
			res.status(200).send({ success: true });
		})
		.catch(err => errorMessage(err, res));
});

// UNSUBSCRIBE FOR PUSH NOTIFICATIONS
app.delete('/push/subscribe', (req, res) => {
	subscription
		.where('subscription.endpoint', '==', req.body.subscription.endpoint)
		.get()
		.then(snapshot => {
			snapshot.forEach(doc => {
				subscription.doc(doc.id).delete();
			});
			res.status(200).send({ success: true });
		})
		.catch(err => errorMessage(err, res));
});

// UPDATE SUBSCRIBTION ( USEALY NOTIFICATION TIME )
app.patch('/push/subscribe', (req, res) => {
	const timezone = req.body.timezone || defaultsValues.timezone;
	const time = req.body.time || defaultsValues.time;
	const update = {
		subscription: req.body.subscription,
		time,
		timezone,
		computed_time: time + timezone
	};

	subscription
		.where('subscription.endpoint', '==', update.subscription.endpoint)
		.get()
		.then(snapshot => {
			snapshot.forEach(doc => {
				subscription.doc(doc.id).set(update);
			});
			res.status(200).send({ success: true });
		})
		.catch(err => errorMessage(err, res));
});

app.get('/push/send', (req, res) => {
	webpush.setGCMAPIKey(GCMApiKey);

	const date = new Date();
	const currentHour = date.getHours() + date.getTimezoneOffset() / 60;
	subscription
		.where('computed_time', '==', currentHour)
		.get()
		.then(snapshot => {
			snapshot.forEach(doc => {
				webpush.sendNotification(doc.data().subscription);
			});
			res.status(200).send({ success: true, hour: currentHour });
		})
		.catch(err => errorMessage(err, res));
});

// Expose the API as a function
exports.api = functions.https.onRequest(app);

function requestWeather(lat, lng) {
	return new Promise((resolve, reject) => {
		request(
			`https://api.darksky.net/forecast/${darkSkyApiKey}/${lat},${lng}?exclude=minutely,flags&units=si`,
			(error, response, body) => {
				if (!error && response.statusCode === 200) {
					const data = _.pick(JSON.parse(body), [
						'currently.time',
						'currently.summary',
						'currently.icon',
						'currently.temperature',
						'currently.apparentTemperature',
						'currently.windSpeed',
						'currently.windBearing',
						'currently.humidity',
						'currently.precipProbability',
						'hourly.summary',
						'hourly.data',
						'daily.summary',
						'daily.data'
					]);

					data.hourly.data = data.hourly.data.map(day =>
						_.pick(day, [
							'time',
							'summary',
							'icon',
							'temperature',
							'windSpeed',
							'windBearing',
							'precipProbability',
							'humidity'
						])
					);

					data.daily.data = data.daily.data.map(day =>
						_.pick(day, [
							'time',
							'summary',
							'icon',
							'temperatureMin',
							'temperatureMax',
							'sunriseTime',
							'sunsetTime'
						])
					);

					resolve(data);
				}
				else {
					reject(error);
				}
			}
		);
	});
}
