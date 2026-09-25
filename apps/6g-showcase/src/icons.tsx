import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.8"
      {...props}
    >
      {children}
    </svg>
  );
}

export const ArrowIcon = (props: IconProps) => (
  <Icon {...props}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14m-5-5 5 5-5 5" />
  </Icon>
);
export const GitHubIcon = (props: IconProps) => (
  <Icon {...props}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 2.8a9.2 9.2 0 0 0-2.9 17.9c.5.1.7-.2.7-.5v-1.8c-2.8.6-3.4-1.2-3.4-1.2-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.6 1.1 1.6 1.1.9 1.6 2.4 1.1 2.9.9.1-.7.4-1.1.7-1.4-2.2-.3-4.6-1.1-4.6-4.9 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.8 1a9.4 9.4 0 0 1 5 0c2-1.3 2.8-1 2.8-1 .5 1.4.2 2.4.1 2.7.7.7 1 1.6 1 2.7 0 3.8-2.3 4.6-4.6 4.9.4.3.7 1 .7 1.9v2.7c0 .3.2.6.7.5A9.2 9.2 0 0 0 12 2.8Z"
    />
  </Icon>
);
export const PauseIcon = (props: IconProps) => (
  <Icon {...props}>
    <path strokeLinecap="round" d="M9 7v10m6-10v10" />
  </Icon>
);
export const PlayIcon = (props: IconProps) => (
  <Icon {...props}>
    <path strokeLinejoin="round" d="m9 6 9 6-9 6V6Z" />
  </Icon>
);
export const SoundIcon = (props: IconProps) => (
  <Icon {...props}>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M6 10H3v4h3l4 3V7l-4 3Zm8-.5a4 4 0 0 1 0 5m2.7-7.7a7.4 7.4 0 0 1 0 10.4"
    />
  </Icon>
);
export const VrIcon = (props: IconProps) => (
  <Icon {...props}>
    <path
      strokeLinejoin="round"
      d="M4 7.5h16l1 3v4.5a2 2 0 0 1-2 2h-3.5l-2-3h-3l-2 3H5a2 2 0 0 1-2-2v-4.5l1-3Z"
    />
    <path d="M7 11.5h2m6 0h2" />
  </Icon>
);
