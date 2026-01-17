# Voice Chat Application

A real-time multilingual voice chat application built with Next.js, featuring live transcription and translation capabilities.

## Features

- 🎤 **Voice Recording**: Record and transmit audio in real-time
- 🌍 **Multilingual Support**: Support for 8+ languages including English, Chinese, Japanese, Spanish, French, German, Korean, and Portuguese
- 📝 **Live Transcription**: Real-time speech-to-text transcription
- 🔄 **Translation**: Automatic translation of transcribed messages
- 💬 **Chat Interface**: Modern chat UI with message history
- 👥 **Room-based Communication**: Join and participate in voice chat rooms
- 🎨 **Modern UI**: Built with Radix UI components and Tailwind CSS
- 🌓 **Theme Support**: Light and dark mode

## Tech Stack

- **Framework**: Next.js 15.2.4
- **Language**: TypeScript
- **UI Components**: Radix UI
- **Styling**: Tailwind CSS
- **State Management**: React Hooks
- **Audio Processing**: Web Audio API
- **Deployment**: Vercel

## Getting Started

### Prerequisites

- Node.js 18+ 
- pnpm (recommended) or npm

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd mvp_29
```

2. Install dependencies:
```bash
pnpm install
```

3. Run the development server:
```bash
pnpm dev
```

4. Open [http://localhost:3000](http://localhost:3000) in your browser

## Project Structure

```
├── app/                    # Next.js app directory
│   ├── api/               # API routes
│   │   ├── rooms/        # Room management endpoints
│   │   ├── transcribe/   # Transcription endpoints
│   │   └── translate/    # Translation endpoints
│   └── page.tsx          # Main page
├── components/            # React components
│   ├── ui/               # Reusable UI components
│   ├── voice-chat-interface.tsx
│   ├── chat-area.tsx
│   └── voice-controls.tsx
├── hooks/                # Custom React hooks
├── lib/                  # Utility functions
└── public/               # Static assets
```

## Scripts

- `pnpm dev` - Start development server
- `pnpm build` - Build for production
- `pnpm start` - Start production server
- `pnpm lint` - Run ESLint

## Environment Variables

Create a `.env.local` file with the following variables (if needed):

```
# Add your API keys and configuration here
```

## License

Private project

