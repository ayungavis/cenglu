import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { APP_CONSTANT } from "@/constants/app.constant";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: APP_CONSTANT.APP_NAME,
    },
    githubUrl: APP_CONSTANT.GITHUB_URL,
  };
}
