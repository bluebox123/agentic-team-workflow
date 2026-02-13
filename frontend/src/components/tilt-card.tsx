import { motion, useMotionValue, useSpring, useTransform } from "framer-motion"
import React, { useRef } from "react"
import { cn } from "@/lib/utils"

interface TiltCardProps extends React.HTMLAttributes<HTMLDivElement> {
    children: React.ReactNode
}

export function TiltCard({ children, className, ...props }: TiltCardProps) {
    const ref = useRef<HTMLDivElement>(null)

    const x = useMotionValue(0)
    const y = useMotionValue(0)

    const mouseXSpring = useSpring(x)
    const mouseYSpring = useSpring(y)

    const rotateX = useTransform(mouseYSpring, [-0.5, 0.5], ["17.5deg", "-17.5deg"])
    const rotateY = useTransform(mouseXSpring, [-0.5, 0.5], ["-17.5deg", "17.5deg"])

    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!ref.current) return

        const rect = ref.current.getBoundingClientRect()

        const width = rect.width
        const height = rect.height

        const mouseX = e.clientX - rect.left
        const mouseY = e.clientY - rect.top

        const xPct = mouseX / width - 0.5
        const yPct = mouseY / height - 0.5

        x.set(xPct)
        y.set(yPct)
    }

    const handleMouseLeave = () => {
        x.set(0)
        y.set(0)
    }

    return (
        <motion.div
            ref={ref}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            style={{
                rotateY,
                rotateX,
                transformStyle: "preserve-3d",
            }}
            className={cn("relative group", className)}
            {...props as any}
        >
            <div
                style={{ transform: "translateZ(75px)", transformStyle: "preserve-3d" }}
                className="w-full h-full"
            >
                {children}
            </div>
            {/* Reflection gradient */}
            <motion.div
                style={{
                    background: useTransform(
                        mouseXSpring,
                        [-0.5, 0.5],
                        [
                            "linear-gradient(to right, rgba(255,255,255,0) 0%, rgba(255,255,255,0) 100%)",
                            "linear-gradient(to right, rgba(255,255,255,0) 0%, rgba(255,255,255,0.1) 50%, rgba(255,255,255,0) 100%)"
                        ]
                    ),
                    opacity: useTransform(mouseXSpring, [-0.5, 0, 0.5], [0, 1, 0])
                }}
                className="absolute inset-0 z-10 rounded-xl events-none"
            />
        </motion.div>
    )
}
