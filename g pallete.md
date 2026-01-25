Here's the design guide rewritten for your indigo monochromatic brutalist palette with Gemini's gradient energy philosophy:

---

# Indigo Gradient System
## Technical Brutalism with Fluid Energy

### Core Philosophy

Merge Gemini's "gradient as energy transfer" concept with a strict monochromatic indigo palette and hard-offset brutalist shadows. Where Gemini uses rainbow gradients to soften AI's abstraction, this system uses **monochromatic energy flows** within a technical, code-editor aesthetic.

**Key Principle**: *Precision with pulse—technical rigor meets organic motion.*

---

### 1. Color System: Monochromatic Energy

#### Base Palette (OKLCH)
Your palette centers on a single hue family (271-279°) with varying lightness and chroma:

- **Primary Indigo**: `oklch(0.5066 0.2501 271.8903)` - The core energy color
- **Deep Indigo**: `oklch(0.4486 0.2266 271.5512)` - Shadows and depth
- **Bright Indigo**: `oklch(0.468 0.2721 279.6007)` - Rings and focus states
- **Dark Background**: `oklch(0 0.151 268.343)` - Dark mode base
- **Light Background**: `oklch(0.98 0 0)` - Light mode base
- **Pure White**: `oklch(1 0 0)` - Cards, popovers, highlights

#### Gradient Architecture

**Directional Energy Gradients**
Replace Google's four-color rainbow with **indigo saturation gradients**:

- **Structure**: Sharp, high-chroma leading edge (`0.2501` chroma) fading to low-chroma tail (`0.05` or neutral)
- **Direction**: Always horizontal or diagonal (45°) to suggest data flow
- **Light Mode**: 
  ```css
  background: linear-gradient(90deg, 
    oklch(0.5066 0.2501 271.8903) 0%, 
    oklch(0.5066 0.1 271.8903) 40%, 
    oklch(0.98 0 0) 100%);
  ```
- **Dark Mode**:
  ```css
  background: linear-gradient(90deg, 
    oklch(0.972 0.016 110.55) 0%, 
    oklch(0.5066 0.15 271.8903) 50%, 
    oklch(0 0.151 268.343) 100%);
  ```

**Two Energy States**

1. **Concentrated (Active/Processing)**
   - Full chroma (`0.2501`) at source
   - Sharp, opaque leading edge
   - High contrast against background
   - Hard shadow offset (4px 4px 0px) in primary color

2. **Diffused (Idle/Ambient)**
   - Reduced chroma (`0.05-0.1`)
   - Extended fade with blur
   - Soft shadow or no shadow
   - Background-integrated

---

### 2. Shape Language: Hard Shadows & Sharp Corners

#### The Brutalist Shadow System
Your shadows are **hard, offset, and technical**—not soft diffusion:

- **Standard**: `4px 4px 0px 0px oklch(0.427 0.149 277.089)`
- **Hover**: `6px 6px 0px 0px oklch(0.427 0.149 277.089)` (increased offset)
- **Active**: `2px 2px 0px 0px oklch(0.427 0.149 277.089)` (pressed state)
- **Color**: Shadow matches border color for cohesion

#### Geometric Foundation
- **Corners**: Sharp (0px radius) for containers, subtle rounding (4px) for interactive elements
- **Borders**: 1px solid `oklch(0.5066 0.2501 271.8903)` - always visible, never subtle
- **Spacing**: 8px grid (`--spacing: 0.25rem`) with hard edges

#### Negative Space
- Use the **hard shadow** to create depth instead of gradients
- Allow gradient energy to "flow" behind the hard shadow lines
- White space is `oklch(0.98 0 0)` in light mode, deep indigo in dark

---

### 3. Motion Design: Technical Precision

#### Animation Principles

**1. Defined Start/End Points**
Every gradient animation has clear origin/destination:
- **Enter**: Sharp indigo edge slides in from left (transform: translateX)
- **Exit**: Retracts to right with chroma fade
- **Duration**: 200-400ms (technical, snappy, not ethereal)

**2. Inner Activity (Processing States)**
Visualize active processing through:
- **Chroma Pulse**: Cycle between `0.15` and `0.2501` chroma values
- **Shadow Shift**: Hard shadow moves 2px-6px-2px to suggest mechanical action
- **Border Flash**: 1px border brightens to `oklch(0.972 0.016 110.55)` then returns

**3. Voice/Input Visualization**
- Use **horizontal bars** instead of radial ripples (technical aesthetic)
- Sharp leading edge in primary indigo
- Tail fades to background color
- Synchronized with hard shadow pulsing

#### Motion Curves
- **Easing**: `cubic-bezier(0.4, 0.0, 0.2, 1)` for UI transitions
- **Linear**: For continuous data flows (energy transfer visualization)
- **Steps**: Use `steps(4)` for glitch/technical effects during processing

---

### 4. Typography: Geist Mono Dominance

#### Font Stack
- **Primary**: `Geist Mono, monospace` - Technical, code-editor aesthetic
- **Display**: `Playfair Display, serif` - Occasional contrast for headers only
- **Tracking**: `0em` (tight, technical)

#### Text Treatment
- **Headlines**: Primary indigo color, Geist Mono, uppercase for labels
- **Body**: Muted indigo (`oklch(0.5066 0.2501 271.8903)`), regular weight
- **Gradient Text**: Use `background-clip: text` with indigo-to-white gradient
- **Shadows**: Text uses hard offset shadows matching the design system

#### Code Aesthetic
- Monospace for all UI text (buttons, labels, navigation)
- Serif only for long-form content or quotes
- Consistent `0em` tracking throughout

---

### 5. Component Library

#### Buttons
- **Primary**: 
  - Background: `oklch(0.5066 0.2501 271.8903)`
  - Text: White (`oklch(1 0 0)`)
  - Border: 1px solid `oklch(0.4486 0.2266 271.5512)`
  - Shadow: `4px 4px 0px 0px oklch(0.427 0.149 277.089)`
  - Hover: Shadow increases to 6px, translate(-2px, -2px)

- **Secondary**: 
  - Background: White or transparent
  - Border: 1px solid primary
  - Shadow: Same hard offset
  - Text: Primary indigo

#### Input Fields
- **Active State**: 
  - Border: 2px solid primary indigo
  - Shadow: `4px 4px 0px 0px oklch(0.427 0.149 277.089)`
  - Gradient underline: Sharp indigo left, fading right

- **Focus**: 
  - Ring: `oklch(0.468 0.2721 279.6007)` (bright indigo)
  - Hard shadow remains, no blur

#### Cards/Containers
- **Background**: White (`oklch(1 0 0)`) or dark card bg
- **Border**: 1px solid `oklch(0.5066 0.2501 271.8903)`
- **Shadow**: `4px 4px 0px 0px oklch(0.427 0.149 277.089)`
- **Hover**: Shadow expands, card lifts (translate -2px, -2px)

#### Loading/Processing Indicators
- **Shape**: Horizontal bars or sharp-cornered rectangles (not circles)
- **Animation**: 
  - Gradient flows left-to-right with sharp indigo edge
  - Hard shadow pulses in sync
  - Chroma oscillates between 0.15 and 0.25

---

### 6. Layout Guidelines

#### Spacing System
- **Base**: 4px (0.25rem) increments
- **Hard gutters**: 24-32px padding with visible borders
- **Grid**: 8px base with 1px indigo grid lines (optional technical aesthetic)

#### Z-Layering with Shadows
- **Z-0**: Background (`oklch(0.98 0 0)` or `oklch(0 0.151 268.343)`)
- **Z-1**: Content layer (white cards)
- **Z-2**: Hard shadow layer (4px offset)
- **Z-3**: Active elements with gradient energy
- **Z-4**: Floating elements with expanded shadows (6px+)

#### Light vs Dark Modes

**Light Mode**:
- Background: `oklch(0.98 0 0)` (warm white)
- Cards: Pure white `oklch(1 0 0)`
- Text: Primary indigo
- Shadows: Indigo-tinted hard shadows

**Dark Mode**:
- Background: `oklch(0 0.151 268.343)` (deep indigo-black)
- Cards: `oklch(0 0.151 268.343)` with lighter borders
- Text: `oklch(0.972 0.016 110.55)` (warm white)
- Shadows: Darker indigo `oklch(0.427 0.149 277.089)`

---

### 7. Implementation Examples

#### CSS Variables (Your Provided Palette)
```css
:root {
  --energy-primary: oklch(0.5066 0.2501 271.8903);
  --energy-deep: oklch(0.4486 0.2266 271.5512);
  --energy-bright: oklch(0.468 0.2721 279.6007);
  --bg-light: oklch(0.98 0 0);
  --bg-dark: oklch(0 0.151 268.343);
  --shadow-hard: 4px 4px 0px 0px oklch(0.427 0.149 277.089);
  --shadow-hard-hover: 6px 6px 0px 0px oklch(0.427 0.149 277.089);
  --gradient-sharp: linear-gradient(90deg, 
    oklch(0.5066 0.2501 271.8903) 0%, 
    oklch(0.5066 0.05 271.8903) 60%, 
    transparent 100%);
}
```

#### Processing Animation
```css
@keyframes indigo-flow {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

.processing-bar {
  background: linear-gradient(90deg, 
    transparent 0%,
    oklch(0.5066 0.2501 271.8903) 50%,
    transparent 100%);
  background-size: 50% 100%;
  animation: indigo-flow 2s linear infinite;
  height: 4px;
  border: 1px solid var(--energy-deep);
  box-shadow: var(--shadow-hard);
}
```

#### Button with Hard Shadow
```css
.btn-brutalist {
  background: oklch(0.5066 0.2501 271.8903);
  color: oklch(1 0 0);
  border: 1px solid oklch(0.4486 0.2266 271.5512);
  box-shadow: 4px 4px 0px 0px oklch(0.427 0.149 277.089);
  font-family: 'Geist Mono', monospace;
  padding: 0.75rem 1.5rem;
  transition: all 0.2s cubic-bezier(0.4, 0.0, 0.2, 1);
}

.btn-brutalist:hover {
  transform: translate(-2px, -2px);
  box-shadow: 6px 6px 0px 0px oklch(0.427 0.149 277.089);
}

.btn-brutalist:active {
  transform: translate(2px, 2px);
  box-shadow: 2px 2px 0px 0px oklch(0.427 0.149 277.089);
}
```

#### Card with Gradient Header
```css
.card-energy {
  background: oklch(1 0 0);
  border: 1px solid oklch(0.5066 0.2501 271.8903);
  box-shadow: 4px 4px 0px 0px oklch(0.427 0.149 277.089);
}

.card-energy::before {
  content: '';
  display: block;
  height: 4px;
  background: linear-gradient(90deg, 
    oklch(0.5066 0.2501 271.8903) 0%,
    oklch(0.5066 0.1 271.8903) 100%);
  border-bottom: 1px solid oklch(0.4486 0.2266 271.5512);
}
```

---

### 8. Do's and Don'ts

**Do:**
- Use sharp, 1px borders on every element
- Apply hard offset shadows (4px 4px 0px) consistently
- Animate gradients with linear timing for technical precision
- Use Geist Mono for all UI text
- Maintain the indigo hue family strictly (271-279°)
- Increase shadow offset on hover (lift effect)
- Use high chroma (0.25) only for active/primary elements

**Don't:**
- Use soft, blurred shadows (box-shadow with blur > 0)
- Introduce colors outside the indigo family (no reds, greens, yellows)
- Use border-radius > 8px (avoid excessive rounding)
- Animate with ease-in-out for processing states (too soft)
- Use low-contrast text (always maintain readability)
- Remove the hard shadow on interactive elements

---

### 9. Accessibility

- **Contrast**: Primary indigo on white provides ~7:1 contrast ratio
- **Motion**: Respect `prefers-reduced-motion` by disabling gradient animations
- **Focus States**: Use `oklch(0.468 0.2721 279.6007)` ring (bright indigo) with 2px offset
- **Shadows**: Hard shadows provide clear depth cues for low-vision users

---

This system creates an interface that feels **technical, precise, and energetic**—like a high-end code editor with living, breathing data flows. The hard shadows provide the brutalist structure while the indigo gradients add the Gemini-inspired energy transfer visualization.