"use client";

import { CopyIcon, ExternalLinkIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "~/components/ui/input-otp";

/** QR code, the manual key, and a 6-digit input for the first code */
export function TotpEnrolment({
  qrDataUrl,
  manualKey,
  otpUri,
  code,
  onCodeChange,
  onComplete,
}: {
  qrDataUrl: string;
  manualKey: string;
  otpUri: string;
  code: string;
  onCodeChange: (value: string) => void;
  onComplete?: (value: string) => void;
}) {
  const t = useTranslations("auth.register");
  const tc = useTranslations("common");

  const copyKey = async () => {
    try {
      await navigator.clipboard.writeText(manualKey);
      toast.success(tc("copied"));
    } catch {
      // no clipboard access (plain http): the key is select-all for this
      toast.error(t("copyFailed"));
    }
  };

  return (
    <div className="flex flex-col items-center gap-4">
      <p className="text-muted-foreground text-sm">{t("scanHint")}</p>
      {/* biome-ignore lint/performance/noImgElement: a data: URL, nothing to optimise */}
      <img
        src={qrDataUrl}
        alt={t("scanTitle")}
        width={200}
        height={200}
        className="rounded-lg border bg-white p-2"
      />
      <div className="w-full text-center">
        <p className="text-muted-foreground text-xs">{t("manualKey")}</p>
        {/* wraps between groups only, so a group is never split */}
        <code className="bg-muted mt-1 flex flex-wrap justify-center gap-x-2 rounded-md px-2 py-1 font-mono text-xs select-all">
          {manualKey.match(/.{1,4}/g)?.map((group, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: groups can repeat
            <span key={index}>{group}</span>
          ))}
        </code>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void copyKey()}
          >
            <CopyIcon />
            {t("copyKey")}
          </Button>
          {/* the QR code cannot be scanned by the phone showing it */}
          <Button variant="outline" size="sm" className="md:hidden" asChild>
            <a href={otpUri}>
              <ExternalLinkIcon />
              {t("openAuthenticator")}
            </a>
          </Button>
        </div>
      </div>
      <InputOTP
        maxLength={6}
        inputMode="numeric"
        pattern="^[0-9]*$"
        autoComplete="one-time-code"
        value={code}
        onChange={onCodeChange}
        onComplete={onComplete}
        aria-label={t("code")}
      >
        <InputOTPGroup>
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <InputOTPSlot key={index} index={index} />
          ))}
        </InputOTPGroup>
      </InputOTP>
    </div>
  );
}
