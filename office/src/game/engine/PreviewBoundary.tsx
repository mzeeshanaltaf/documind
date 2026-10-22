import { Component, type ReactNode } from "react";

/**
 * Around the decorative 3D previews (the home's diorama, the globe): if WebGL is missing or the
 * scene throws, they disappear and the page around them (the lists) carries on.
 */
export class PreviewBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn("[preview] 3D preview unavailable", error);
  }

  render() {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children;
  }
}
