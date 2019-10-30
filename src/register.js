const superagent = require('superagent');

class Register {

  /**
   * Service Register proxy
   *
   * @param {String} registerURL URL of the register to use
   */
  constructor(registerURL) {
    this.registerURL = registerURL;
  }

  /**
   * Find services in the register that conform to a profile
   * 
   * @param {String} profileId Id of the profile the matching sarvice has to support
   */
  async findServices(profileId) {
    const response =
      await superagent
        .get(`${this.registerURL}/search/`)
        .query({ semanticProfile: profileId })
        .set('accept', 'application/json')

    const services = response.body['disco'];
    if (!services || !services.length)
      return Promise.reject(`No service for profile '${profileId}' found.`);

    return services;
  }
}

module.exports = Register;


