export function getApplianceServiceUrl() {
  return process.env.APPLIANCE_SERVICE_URL ?? "http://127.0.0.1:5002";
}
