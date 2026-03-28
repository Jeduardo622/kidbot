interface LiveRegionProps {
  message: string;
  isAlert?: boolean;
}

export const LiveRegion = ({ message, isAlert = false }: LiveRegionProps) => (
  <p className="sr-only" role={isAlert ? 'alert' : 'status'} aria-live={isAlert ? 'assertive' : 'polite'} aria-atomic="true">
    {message}
  </p>
);
