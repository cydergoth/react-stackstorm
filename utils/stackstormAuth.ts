import { FetchError } from "./fetch";

const ST2_API_AUTH = "/lifecycle/api/v1/user/auth";

// Magic function to exhange user's SSO credentials for a Stackstorm token
// This uses a relay API exposed by the lifecycle service so we don't
// expose the ST2 auth endpoint directly.
// Note that this method results in a *** side effect *** of storing
// the stackstorm auth token in the cookies! Hence the result may
// be ignored
export const st2_auth = async (ctx: any, _: any): Promise<any> => {
  return fetch(ST2_API_AUTH, {
    method: "GET",
    cache: "no-cache"
  }).then((res) => {
    if (!res.ok) {
      console.log("Auth failed", res);
      throw new FetchError("Stackstorm Auth failed: " + res.statusText, res);
    } else {
      return res;
    }
  }).then((res) => res);
}
