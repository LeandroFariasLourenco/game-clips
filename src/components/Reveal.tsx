import React from 'react';
import { motion, type HTMLMotionProps } from 'motion/react';
import { revealTransition } from '../motion';

type RevealProps = HTMLMotionProps<'div'> & {
  delay?: number;
};

export const Reveal: React.FC<RevealProps> = ({
  delay = 0,
  children,
  ...props
}) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.12 }}
      transition={{ ...revealTransition, delay }}
      {...props}
    >
      {children}
    </motion.div>
  );
};
