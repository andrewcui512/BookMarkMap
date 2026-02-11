/// <reference types="chrome" />

// Extend chrome types as needed
declare module '*.css' {
    const content: Record<string, string>;
    export default content;
}

declare module '*.png' {
    const value: string;
    export default value;
}

declare module '*.svg' {
    const value: string;
    export default value;
}
