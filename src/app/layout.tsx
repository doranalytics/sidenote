import type { Metadata, Viewport } from "next";
import "./globals.css";
import { isDemo } from "@/lib/store";

// Build-time values so the snippet can be inlined; absent means no analytics.
const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY ?? "";
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

export const metadata: Metadata = {
  metadataBase: new URL("https://sidenote.lol"),
  title: "Sidenote — remember your conversations",
  description:
    "An iMessage companion. Search everything you've ever texted, keep notes on the people you care about, and right-click any message to have AI explain what it means.",
  openGraph: {
    title: "Sidenote — every text, remembered",
    description:
      "Search your entire iMessage history, pin the moments that matter, and right-click any message to ask what it means.",
    url: "https://sidenote.lol",
    siteName: "Sidenote",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Sidenote" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Sidenote — every text, remembered",
    description:
      "Search your entire iMessage history, pin the moments that matter, and right-click any message to ask what it means.",
    images: ["/og.png"],
  },
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icon-512.png",
    apple: "/apple-icon.png",
  },
  appleWebApp: {
    capable: true,
    title: "Sidenote",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f5f7" },
    { media: "(prefers-color-scheme: dark)", color: "#1c1c1e" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "if(matchMedia('(prefers-color-scheme: dark)').matches)document.documentElement.classList.add('dark')",
          }}
        />
        {/* Web analytics for sidenote.lol only — pageviews, visitors, where
            people came from. Deliberately NOT loaded inside Sidenote.app: the
            app reports its own events server-side, from one auditable place,
            and never captures page text or clicks. */}
        {/* DXYZ Dashboard beacon — unique-visitor counting for the public
            site only, on the same isDemo gate as the analytics snippet: the
            packaged app must never report itself as web traffic. */}
        {isDemo && (
          <script defer src="https://dxyz-dashboard.vercel.app/d/sidenote.js" />
        )}
        {isDemo && POSTHOG_KEY && (
          <script
            dangerouslySetInnerHTML={{
              __html: `!function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSurveysLoaded onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug getPageViewId captureTraceFeedback captureTraceMetric".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);posthog.init(${JSON.stringify(POSTHOG_KEY)},{api_host:${JSON.stringify(POSTHOG_HOST)},defaults:"2025-05-24"});`,
            }}
          />
        )}
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
