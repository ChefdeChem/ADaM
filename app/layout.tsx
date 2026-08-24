import type { Metadata } from "next";
import "./globals.css";
export const metadata:Metadata={title:"ADaM Combat Trainer",description:"Import a D&D character, choose a ruleset, and test combat mechanics.",icons:{icon:"/favicon.svg",shortcut:"/favicon.svg"}};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="en"><body>{children}</body></html>}
