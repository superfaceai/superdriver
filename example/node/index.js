const { Register, Consumer } = require('../..');

// const REGISTRY_URL = 'http://localhost:8010/proxy';
const REGISTRY_URL = 'http://46.101.144.137:8282';
const PROFILE_ID = 'http://supermodel.io/weather/profile/WeatherAlerts';

const app = async function () {
  const registry = new Register(REGISTRY_URL)
  console.log(registry)

  const services = await registry.findServices(PROFILE_ID)
  console.log(services)

  if (services && services.length) {
    const service = services[0]
    console.log(service)
    try {
      const client = new Consumer({
        serviceURL: service.serviceURL,
        profileId: PROFILE_ID,
      });
      const response = await client.perform({
        operation: 'RetrieveAlert',
        parameters: {
          addressLocality: 'Paris',
        },
        response: [
          'ActualWeatherAlert/title',
          'ActualWeatherAlert/description'
        ]
      });
      console.log('fetched data', JSON.stringify(response, null, 2));
      return { service, response }
    }
    catch (e) {
      console.error('error', e);
    }
  }
  // return {
  //   shows: data.map(entry => entry.show)
  // };
  return {}
};


app()