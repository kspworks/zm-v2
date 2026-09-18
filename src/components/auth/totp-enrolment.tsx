"use client";

import { useTranslations } from "next-intl";

import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "~/components/ui/input-otp";

/** QR code, the manual key, and a 6-digit input for the first code */
export function TotpEnrolment({
  qrDataUrl,
  manualKey,
  code,
  onCodeChange,
  onComplete,
}: {
  qrDataUrl: string;
  manualKey: string;
  code: string;
  onCodeChange: (value: string) => void;
  onComplete?: (value: string) => void;
}) {
  const t = useTranslations("auth.register");

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
        <code className="mt-1 block select-all break-all rounded-md bg-muted px-2 py-1 font-mono text-xs">
          {manualKey.match(/.{1,4}/g)?.join(" ")}
        </code>
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
