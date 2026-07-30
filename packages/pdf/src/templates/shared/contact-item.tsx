import type { Style } from "@react-pdf/types";
import type { CustomField } from "@reactive-resume/schema/resume/data";
import type { IconName } from "phosphor-icons-react-pdf/dynamic";
// biome-ignore lint/correctness/noUnusedImports: React must be in scope for the server's classic JSX transform.
import React from "react";
import { View } from "#react-pdf-renderer";
import { getCustomFieldLinkUrl, getWebsiteDisplayText } from "./contact";
import { Icon, Link, Text } from "./primitives";

type ContactStyle = Style | Style[];

type WebsiteDisplay = {
	url: string;
	label?: string | undefined;
};

type WebsiteContactItemProps = {
	website: WebsiteDisplay;
	style?: ContactStyle;
	textStyle?: ContactStyle;
	iconColor?: string;
};

type CustomFieldContactItemProps = {
	field: CustomField;
	style?: ContactStyle;
	textStyle?: ContactStyle;
	iconColor?: string;
};

export const WebsiteContactItem = ({ website, style, textStyle, iconColor }: WebsiteContactItemProps) => {
	if (!website.url) return null;

	return (
		<Link src={website.url} {...(style ? { style } : {})}>
			<Icon name="globe" {...(iconColor ? { color: iconColor } : {})} />
			<Text {...(textStyle ? { style: textStyle } : {})}>{getWebsiteDisplayText(website)}</Text>
		</Link>
	);
};

export const CustomFieldContactItem = ({ field, style, textStyle, iconColor }: CustomFieldContactItemProps) => {
	const linkUrl = getCustomFieldLinkUrl(field);
	const children = (
		<>
			<Icon name={field.icon as IconName} {...(iconColor ? { color: iconColor } : {})} />
			<Text {...(textStyle ? { style: textStyle } : {})}>{field.text}</Text>
		</>
	);

	if (linkUrl) {
		return (
			<Link src={linkUrl} {...(style ? { style } : {})}>
				{children}
			</Link>
		);
	}

	return <View {...(style ? { style } : {})}>{children}</View>;
};

type EmailContactItemProps = {
	email: string;
	style?: ContactStyle;
	textStyle?: ContactStyle;
	iconColor?: string;
	/** Override icon; defaults to "envelope". ditgar uses "at". */
	iconName?: IconName;
};

export const EmailContactItem = ({
	email,
	style,
	textStyle,
	iconColor,
	iconName = "envelope",
}: EmailContactItemProps) => {
	if (!email) return null;
	return (
		<Link src={`mailto:${email}`} {...(style ? { style } : {})}>
			<Icon name={iconName} {...(iconColor ? { color: iconColor } : {})} />
			<Text {...(textStyle ? { style: textStyle } : {})}>{email}</Text>
		</Link>
	);
};

type PhoneContactItemProps = {
	phone: string;
	style?: ContactStyle;
	textStyle?: ContactStyle;
	iconColor?: string;
};

export const PhoneContactItem = ({ phone, style, textStyle, iconColor }: PhoneContactItemProps) => {
	if (!phone) return null;
	return (
		<Link src={`tel:${phone}`} {...(style ? { style } : {})}>
			<Icon name="phone" {...(iconColor ? { color: iconColor } : {})} />
			<Text {...(textStyle ? { style: textStyle } : {})}>{phone}</Text>
		</Link>
	);
};

type LocationContactItemProps = {
	location: string;
	style?: ContactStyle;
	textStyle?: ContactStyle;
	iconColor?: string;
};

export const LocationContactItem = ({ location, style, textStyle, iconColor }: LocationContactItemProps) => {
	if (!location) return null;
	return (
		<View {...(style ? { style } : {})}>
			<Icon name="map-pin" {...(iconColor ? { color: iconColor } : {})} />
			<Text {...(textStyle ? { style: textStyle } : {})}>{location}</Text>
		</View>
	);
};
