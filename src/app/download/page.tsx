import type { Metadata } from "next";
import { DownloadAgain } from "@/components/download-again";

export const metadata: Metadata = {
  title: "Download Sidenote",
  description: "Sign in with the email you bought Sidenote with to download it again.",
};

export default function DownloadPage() {
  return <DownloadAgain />;
}
