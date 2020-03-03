# Superdriver

Level 5 self-driving client for Autonomous APIs. Superdriver is part of the **superface** communication mechanism. Visit [superface.ai](https://superface.ai) for more information.

## Demo 

You can see Superdriver in action at [superface.glitch.me](http://superface.glitch.me), view its sources and remix it at the [Superface Glitch Project Page](https://glitch.com/edit/#!/superface).

## Usage

### Node.js
#### NPM

```
$ npm install --save superdriver
```

#### YARN 
```
$ yarn add superdriver
```

### Browser

Superdriver is universal library working both in Node.js and browser. See the `examples` folder for more details.

### Making Call

```js
import { Consumer } from "superdriver"

const PROFILE_ID = "http://supermodel.io/weather/profile/WeatherAlerts"

const client = new Consumer({
  url: SERVICE_URL,
  mappingUrl: MAPPING_URL,
  profileId: PROFILE_ID
})

const response = await client.perform({
  operation: "RetrieveAlert",
  parameters: {
    addressLocality
  },
  response: [
    "title",
    "description",
    "severity",
    "startDate",
    "endDate"
  ]
})
```

## Superdriver API 

Superdriver has two main components `Register` and `Consumer`. The `Register` serves for interactions with the superface registry. It allows for registering and unregistering superface provider as well as for services lookup. The `Consumer` then performs profile operations with the selected provider.

### Consumer:perform()

Perform an operation with the selected provider.

### Register:findServices()

Query the superface registry returning providers implementing the requested profile.

### Register:registerService()

Reqisters a provider at a superface registry.

### Register:unregisterService()

Un-register (removes) a provider from a superface registry.

## Contact

If you would like to contribute to the superface project or deploy an Autonomous API in your next application, please email <hello@superface.ai> or contact us at [@superfaceai](http://twitter.com/superfaceai) on Twitter.
