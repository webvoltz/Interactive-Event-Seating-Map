# Event Seating Map – Performance & UX Focused Implementation

This project is a high-performance, interactive event seating map built with React, TypeScript, Tailwind CSS, Zustand, Vite and SVG. It is designed to handle large venues with 15,000+ seats while maintaining smooth, responsive, and accessible user interactions.

## Key Features & Design Decisions

1. High-Performance SVG Rendering

**Why SVG instead of Canvas?**  
SVG provides several critical advantages for a seat-selection experience:
- Native accessibility through DOM elements (screen readers, focus management)
- Simple event handling (`onClick`, `handleKeyDown`)
- Straightforward styling using Tailwind CSS

To keep rendering fast at scale, both the `Seat` and `Section` components are wrapped with `React.memo`. This ensures that even with 15,000+ seats, React only re-renders the specific seat whose state changes, allowing the UI to consistently maintain 60 FPS.

2. State Management with Smart Persistence (Zustand)

We use Zustand for state management to keep the store lightweight and free from boilerplate.

Why serialized Sets?  
Seat selection requires fast lookups. Internally, we use a Set for O(1) performance. Since JSON does not support Set, a custom persistence layer was implemented in `seatStore.ts`:
- Selected seats are serialized as arrays for storage
- They are rehydrated back into Set objects on load

UX Enhancement – Context Restoration  
When the page is refreshed:
- Previously selected seats are restored automatically
- The parent section containing those seats is opened
- The map zooms and centers directly on the selected seats

This prevents users from losing context and having to manually navigate back.

3. Navigation: Zoom, Pan & Keyboard Support

**Smart Zoom & Centering**  
Instead of applying a simple zoom, the application calculates the geometric bounds of a section and scrolls the container to center it precisely. This logic is handled inside a useEffect in Section.tsx.

**Mouse Drag Panning**  
The map supports intuitive click-and-drag panning using native mouse events (`onMouseDown`, `onMouseMove`), providing an experience similar to Google Maps or mobile gestures.

**Full Keyboard Accessibility**  
To meet accessibility standards, full keyboard navigation is supported:
- Arrow keys move focus between seats
- Vertical navigation selects the closest X-coordinate in the adjacent row, ensuring natural movement even when rows are misaligned
- Focused seats are visually highlighted using Tailwind’s group utilities

4. Mathematical Section Layout

**Exploded Section View**  
To clearly separate sections, each section is translated outward from the venue center (`1200, 1200`) using vector math. This creates visible aisles between sections and improves clarity when zoomed out.

**Curved Section Covers**  
Instead of simple rectangular overlays, the outermost seats of each section are traced to generate smooth, curved SVG paths, resulting in a more organic and realistic layout.

5. Mobile-First Responsive Strategy

- Adaptive Layout: Tailwind’s grid and flex utilities are used to transition from a desktop side-by-side layout to a stacked, mobile-friendly view
- Floating Booking Bar: On mobile devices, checkout details are hidden behind a floating summary button to maximize usable map space

6. Tech Stack

- Vite – Fast development server and optimized production builds  
- TypeScript – Strong typing across venue data and application state  
- Tailwind CSS – Styling, hover states, and responsive behavior  

7. Running the Project

pnpm install
npx ts-node scripts/generateVenue.ts   # Optional: regenerate the 15k seat layout
pnpm dev
