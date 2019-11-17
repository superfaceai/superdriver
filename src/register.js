import fetch from 'isomorphic-fetch'

export class Register {
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
    try {
      const response = await fetch(
        `${this.registerURL}/search?semanticProfile=${encodeURIComponent(profileId)}`,
        {
          headers: {
            'Accept': 'application/json'
          }
        }
      )

      const body = await response.json()
      const services = body['disco'];

      if (!services || !services.length) {
        throw(`No service for profile '${profileId}' found.`)
      }

      return services;
    } catch(error) {
      throw(`Error while fetching profile ${profileId}: ${error.message}`)
    }
  }
}