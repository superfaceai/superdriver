# Superdriver
Level 5 autopilot for autonomous APIs

## Usage

```
$ yarn add superdriver
```

```js
const superdriver = require('superdriver');

const client = new superdriver.Consumer(ServiceURL, ActualWeatherProfileId);

const response = await
  client.perform({
    operation: 'weather-lookup',    // http://alps.io/profiles/actual-weather#weather-lookup
    parameters: {
      addressLocality: 'Paris'      // http://alps.io/profiles/actual-weather#addressLocality
    },
    response: [
      'airTemperature',             // http://alps.io/profiles/actual-weather#airTemperature
      'windDirection'               // http://alps.io/profiles/actual-weather#windDirection
    ]
  });

console.log(`${ServiceURL}:` , response);
```

