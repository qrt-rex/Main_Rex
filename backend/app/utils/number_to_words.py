def amount_to_words(number: float) -> str:
    """
    Convert a numeric amount into Indian numbering system words.
    Example: 54320.00 -> "Fifty Four Thousand Three Hundred Twenty Rupees Only"
    """
    try:
        n = int(round(number))
    except (ValueError, TypeError):
        return "Zero Rupees Only"

    if n == 0:
        return "Zero Rupees Only"
    if n < 0:
        return "Minus " + amount_to_words(abs(n))

    units = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"]
    teens = ["Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"]
    tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]

    def convert_below_thousand(num: int) -> str:
        res = ""
        if num >= 100:
            res += units[num // 100] + " Hundred "
            num %= 100
        if num >= 20:
            res += tens[num // 10] + " "
            num %= 10
        if 10 <= num < 20:
            res += teens[num - 10] + " "
            num = 0
        if 1 <= num < 10:
            res += units[num] + " "
        return res.strip()

    crores = n // 10000000
    n %= 10000000
    lakhs = n // 100000
    n %= 100000
    thousands = n // 1000
    n %= 1000
    remainder = n

    parts = []
    if crores > 0:
        parts.append(convert_below_thousand(crores) + " Crore")
    if lakhs > 0:
        parts.append(convert_below_thousand(lakhs) + " Lakh")
    if thousands > 0:
        parts.append(convert_below_thousand(thousands) + " Thousand")
    if remainder > 0:
        parts.append(convert_below_thousand(remainder))

    words = " ".join(parts).strip()
    return f"{words} Rupees Only"
