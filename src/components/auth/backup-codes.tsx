"use client";

import { CheckIcon, CopyIcon, DownloadIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "~/components/ui/button";

/** Shows backup codes once, with copy and download */
export function BackupCodes({ codes }: { codes: string[] }) {
  const t = useTranslations("common");
  const [copied, setCopied] = useState(false);
  const text = codes.join("\n");

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const download = () => {
    const url = URL.createObjectURL(
      new Blob([`ZM backup codes\n\n${text}\n`], { type: "text/plain" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "zm-backup-codes.txt";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-3">
      <ul className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/50 p-4 font-mono text-sm">
        {codes.map((code) => (
          <li key={code} className="text-center tabular-nums">
            {code}
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="outline" onClick={copy}>
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? t("copied") : t("copy")}
        </Button>
        <Button type="button" variant="outline" onClick={download}>
          <DownloadIcon />
          {t("download")}
        </Button>
      </div>
    </div>
  );
}
