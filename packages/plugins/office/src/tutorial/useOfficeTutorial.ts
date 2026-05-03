import { useState, useCallback, useEffect } from 'react'

const STORAGE_KEY = 'pixelcity-office-tutorial-completed'
const TOTAL_STEPS = 6

export interface TutorialStep {
  index: number
  title: string
  message: string
  highlightType: 'none' | 'dom'
  domSelector?: string
  canSkip: boolean
  buttonLabel?: string
}

const STEPS: TutorialStep[] = [
  {
    index: 0,
    title: 'Welcome to Your Office',
    message: "This is your office — a pixel workspace where AI agents sit and work. Let me show you around!",
    highlightType: 'none',
    canSkip: false,
    buttonLabel: 'Start Tutorial',
  },
  {
    index: 1,
    title: 'Agents',
    message: 'Click an agent to select them. Right-click a tile to make them walk there. You can add more agents with the + Agent button.',
    highlightType: 'dom',
    domSelector: '.office-agent-controls',
    canSkip: true,
  },
  {
    index: 2,
    title: 'Edit Mode',
    message: 'Click the Edit button to enter Edit Mode. This lets you customize your office layout — paint floors, place walls, and arrange furniture.',
    highlightType: 'dom',
    domSelector: '.office-edit-btn',
    canSkip: true,
  },
  {
    index: 3,
    title: 'Editor Tools',
    message: 'In Edit Mode, a toolbar appears with tools: Floor (paint tiles), Wall (toggle walls), Erase (remove tiles), and Furniture (place items from the catalog). Use R to rotate and Del to delete.',
    highlightType: 'none',
    canSkip: true,
  },
  {
    index: 4,
    title: 'Office Instructions',
    message: 'Use this button to set instructions specific to this office. These are included in the system prompt of every agent spawned here.',
    highlightType: 'dom',
    domSelector: '[data-tutorial="office-config-btn"]',
    canSkip: true,
  },
  {
    index: 5,
    title: "You're All Set!",
    message: "That's the basics! Customize your office, add agents, and let them get to work. You can replay this tutorial anytime from the ? button.",
    highlightType: 'none',
    canSkip: true,
    buttonLabel: 'Finish',
  },
]

export function useOfficeTutorial(ready: boolean) {
  const [step, setStep] = useState(-1) // -1 = inactive

  const isActive = step >= 0

  // Auto-activate on first launch (skip in development)
  useEffect(() => {
    if (ready && !(import.meta as any).env?.DEV && localStorage.getItem(STORAGE_KEY) === null) {
      setStep(0)
    }
  }, [ready])

  const currentStep: TutorialStep | null = step >= 0 && step < TOTAL_STEPS
    ? STEPS[step]
    : null

  const nextStep = useCallback(() => {
    setStep(prev => {
      if (prev >= TOTAL_STEPS - 1) {
        localStorage.setItem(STORAGE_KEY, 'true')
        return -1
      }
      return prev + 1
    })
  }, [])

  const prevStep = useCallback(() => {
    setStep(prev => (prev > 0 ? prev - 1 : prev))
  }, [])

  const endTutorial = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, 'true')
    setStep(-1)
  }, [])

  const replayTutorial = useCallback(() => {
    setStep(0)
  }, [])

  return {
    step,
    isActive,
    currentStep,
    totalSteps: TOTAL_STEPS,
    nextStep,
    prevStep,
    endTutorial,
    replayTutorial,
  }
}
