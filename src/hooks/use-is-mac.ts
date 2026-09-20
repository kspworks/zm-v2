import { useEffect, useState } from "react";

const detectMac = () => {
  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  const platform = nav.userAgentData?.platform ?? nav.platform ?? nav.userAgent;
  return /mac|iphone|ipad|ipod/i.test(platform);
};

/**
 * Whether the browser runs on a platform whose primary modifier is Cmd.
 * Starts as `false` so server and first client render agree; the real value
 * lands after mount.
 */
export function useIsMac() {
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    setIsMac(detectMac());
  }, []);

  return isMac;
}
