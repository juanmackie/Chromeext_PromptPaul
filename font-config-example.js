// Corrected font configuration example (adapted for Chrome extensions)
// Note: This example shows the Next.js approach you provided,
// but for Chrome extensions we use Google Fonts CDN instead

// ❌ Original (had duplicate Geist_Mono import/declaration):
/*
import Geist_Mono from "next/font/google";
import Playfair_Display from "next/font/google";
import Geist_Mono from "next/font/google"; // ❌ Duplicate

const geistMono = Geist_Mono({
  variable: "--font-geistMono",
  subsets: ["latin"],
});

const playfairDisplay = Playfair_Display({
  variable: "--font-playfairDisplay",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({ // ❌ Duplicate
  variable: "--font-geistMono",
  subsets: ["latin"],
});

className={`... geistMono.variable playfairDisplay.variable geistMono.variable`}
*/

// ✅ Corrected version:
import Geist_Mono from "next/font/google";
import Playfair_Display from "next/font/google";

const geistMono = Geist_Mono({
  variable: "--font-geistMono",
  subsets: ["latin"],
});

const playfairDisplay = Playfair_Display({
  variable: "--font-playfairDisplay", 
  subsets: ["latin"],
});

// className={`... ${geistMono.variable} ${playfairDisplay.variable}`}

// For Chrome extensions, we use this approach instead:
// HTML: <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&display=swap" rel="stylesheet">
// HTML: <link href="https://fonts.googleapis.com/css2?family=Geist+Mono:wght@100;200;300;400;500;600;700;800&display=swap" rel="stylesheet">
// CSS: --ext-font-family: 'Playfair Display', serif;
// CSS: --ext-font-mono: Geist Mono, monospace;