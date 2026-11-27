/*! SleepyArmor Lite — Copyright (c) 2026 SamSoSleepy (SleepyShop). All rights reserved.
 * Proprietary. Unauthorized use: 5,000 THB fine + blacklist until paid. See LICENSE.txt. */
import text from '../../LICENSE.txt?raw';

export const LICENSE_TEXT = text;

/**
 * Entitlement / license interface — plug in a real provider later (license key / login via SleepyShop).
 * @typedef {Object} LicenseProvider
 * @property {() => Promise<{active:boolean, plan:string, user?:string}>} status
 * @property {(key:string) => Promise<{ok:boolean, message?:string}>} activate
 * @property {(feature:string) => boolean} can  e.g. 'build', 'debug', 'maxArmors:50'
 */

/** v1: free, everything unlocked. */
export const freeProvider = {
  async status() {
    return { active: true, plan: 'free' };
  },
  async activate() {
    return { ok: false, message: 'License keys are not enabled yet' };
  },
  can() {
    return true;
  },
};

let current = freeProvider;
export const getLicenseProvider = () => current;
/** @param {LicenseProvider} p */
export const setLicenseProvider = (p) => {
  current = p;
};
