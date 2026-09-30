import "./globals.css";

export const metadata = { title: "Everything you said" };

export default function Root({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,600&family=Geist:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
        <meta name="theme-color" content="#7560FF" />
      </head>
      <body>{children}</body>
    </html>
  );
}
