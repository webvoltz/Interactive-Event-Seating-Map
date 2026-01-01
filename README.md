# Event Seating Map

A high-performance, interactive seating map for large venues. Built to handle 15,000+ seats with smooth performance and a premium user experience.

##Quick Start

Get the project running in seconds:

1. **Install dependencies:**
   pnpm install

2. **Generate venue data (Optional):**
   npx ts-node scripts/generateVenue.ts

3. **Start development server:**
   pnpm dev

## Key Features

- Handles thousands of seats smoothly using SVG optimization.
- Intuitive click-and-drag panning and smart zoom.
- Full support for arrow-key navigation between seats.
- Remembers your selected seats even after a page refresh.
- Works beautifully on both desktop and mobile devices.

## Tech Stack

- **React + TypeScript** – Core logic and type safety.
- **Tailwind CSS** – Modern, responsive styling.
- **Zustand** – Lightweight and fast state management.
- **Vite** – Lightning-fast build tool.
